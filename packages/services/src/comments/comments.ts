import { parseMentions, ValidationError, assertFound } from '@circi/core'
import { type Comment, type Database, ForbiddenError, NotFoundError } from '@circi/db'
import {
  getComment,
  insertComment,
  listBuildTeamMembers,
  type WorkspaceMember,
  softDeleteComment,
  updateCommentBody,
  updateCommentRegion,
} from '@circi/db/repositories'

import { assertAllowed, canAdjustCommentRegion } from '#src/access/index.ts'
import { notify } from '#src/notifications/notifications.ts'

/**
 * Comments on a build and the @mentions in them. A mention becomes a `mentioned` notification in
 * the same transaction as the comment, so a notice exists exactly when the comment does.
 */

export const MAX_COMMENT_LENGTH = 5000
const SNIPPET_LENGTH = 140

/**
 * The members a comment's tokens mean. A token names a member by the part of their email before
 * the `@`, or by their name written as one word (`annlee`, `ann-lee`, `ann.lee`, `ann_lee`),
 * case-insensitively. A token that fits nobody, or fits two members, mentions no one: guessing
 * would notify the wrong person. Tokens that are not members are simply dropped.
 */
export function matchMentions(
  tokens: readonly string[],
  members: readonly WorkspaceMember[],
): string[] {
  const owners = new Map<string, Set<string>>()
  const add = (handle: string, userId: string) => {
    if (!handle) return
    const set = owners.get(handle) ?? new Set<string>()
    set.add(userId)
    owners.set(handle, set)
  }
  for (const m of members) {
    add(m.email.split('@')[0]?.toLowerCase() ?? '', m.userId)
    const words = m.name.toLowerCase().split(/\s+/).filter(Boolean)
    for (const joiner of ['', '-', '.', '_']) add(words.join(joiner), m.userId)
  }
  const matched = new Set<string>()
  for (const token of tokens) {
    const [only, ...others] = owners.get(token) ?? []
    if (only && others.length === 0) matched.add(only)
  }
  return [...matched]
}

const mentioned = (body: string, members: readonly WorkspaceMember[]) =>
  matchMentions(parseMentions(body), members)

function checkBody(raw: string): string {
  const body = raw.trim()
  if (!body) throw new ValidationError('Write something to comment')
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError(`A comment can have at most ${MAX_COMMENT_LENGTH} characters`)
  }
  return body
}

async function notifyMentions(
  db: Database,
  comment: Comment,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of userIds) {
    // eslint-disable-next-line no-await-in-loop -- a few people, one transaction
    await notify(db, {
      userId,
      kind: 'mentioned',
      buildId: comment.buildId,
      actorId: comment.authorId,
      payload: { commentId: comment.id, snippet: comment.body.slice(0, SNIPPET_LENGTH) },
    })
  }
}

/**
 * Adds a comment, or a reply when `parentId` is set (threads are one level deep; a reply
 * belongs to its parent's snapshot and has no region of its own). Everyone @mentioned who is a
 * member of the workspace is notified, except the author.
 */
export async function addComment(db: Database, input: addComment.Input): Promise<Comment> {
  const body = checkBody(input.body)
  return db.transaction(async (tx) => {
    let snapshotName = input.snapshotName ?? null
    if (input.parentId) {
      const parent = await getComment(tx, input.parentId)
      if (!parent || parent.buildId !== input.buildId || parent.deletedAt) {
        throw new NotFoundError('Comment not found')
      }
      if (parent.parentId) throw new ValidationError('Reply to the first comment in the thread')
      if (input.region) throw new ValidationError("A reply can't mark a region")
      snapshotName = parent.snapshotName
    }
    if (input.region && !snapshotName) {
      throw new ValidationError('Say which screenshot the region is on')
    }
    const comment = await insertComment(tx, {
      buildId: input.buildId,
      authorId: input.authorId,
      body,
      snapshotName,
      region: input.region ?? null,
      regionSide: input.regionSide ?? 'current',
      parentId: input.parentId ?? null,
    })
    const members = await listBuildTeamMembers(tx, input.buildId)
    await notifyMentions(tx, comment, mentioned(body, members))
    return comment
  })
}
export namespace addComment {
  export interface Input extends Omit<insertComment.Input, 'body'> {
    body: string
  }
}

async function ownComment(db: Database, buildId: string, id: string): Promise<Comment> {
  const comment = await getComment(db, id)
  if (!comment || comment.buildId !== buildId || comment.deletedAt) {
    throw new NotFoundError('Comment not found')
  }
  return comment
}

/** Changes the text of your own comment. Only people it newly @mentions are notified. */
export async function editComment(db: Database, input: editComment.Input): Promise<Comment> {
  const body = checkBody(input.body)
  return db.transaction(async (tx) => {
    const before = await ownComment(tx, input.buildId, input.commentId)
    if (before.authorId !== input.userId) {
      throw new ForbiddenError('You can only edit your own comments')
    }
    const updated = await updateCommentBody(tx, before.id, body)
    assertFound(updated, 'Comment not found')
    const members = await listBuildTeamMembers(tx, input.buildId)
    const already = new Set(mentioned(before.body, members))
    await notifyMentions(
      tx,
      updated,
      mentioned(body, members).filter((id) => !already.has(id)),
    )
    return updated
  })
}
export namespace editComment {
  export interface Input {
    buildId: string
    commentId: string
    userId: string
    body: string
  }
}

/** Deletes a comment: its author may, and so may a workspace owner or admin (`asAdmin`). */
export async function deleteComment(db: Database, input: deleteComment.Input): Promise<void> {
  await db.transaction(async (tx) => {
    const comment = await ownComment(tx, input.buildId, input.commentId)
    if (comment.authorId !== input.userId && !input.asAdmin) {
      throw new ForbiddenError('You can only delete your own comments')
    }
    await softDeleteComment(tx, comment.id)
  })
}
export namespace deleteComment {
  export interface Input {
    buildId: string
    commentId: string
    userId: string
    /** The caller is an owner or admin of the workspace. */
    asAdmin: boolean
  }
}

/** The smallest side of a comment's region, as a fraction of the screenshot (the draw gesture uses the same). */
export const MIN_REGION_FRACTION = 0.01

/**
 * Moves or resizes the region of your own comment. The new region is checked like a drawn one:
 * inside the screenshot and at least 1% of it in each direction. Only the author may; a comment
 * with no region (or a reply) has nothing to adjust.
 */
export async function setCommentRegion(
  db: Database,
  input: setCommentRegion.Input,
): Promise<Comment> {
  const { x, y, width, height } = input.region
  const inside = [x, y, width, height].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
  if (!inside || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
    throw new ValidationError('The region must lie inside the screenshot')
  }
  if (width < MIN_REGION_FRACTION || height < MIN_REGION_FRACTION) {
    throw new ValidationError('The region is too small')
  }
  return db.transaction(async (tx) => {
    const comment = await ownComment(tx, input.buildId, input.commentId)
    assertAllowed(canAdjustCommentRegion({ userId: input.userId }, comment.authorId), {
      notFound: 'Comment not found',
      forbidden: 'You can only adjust the region of your own comments',
    })
    if (comment.parentId || comment.regionX === null) {
      throw new ValidationError('This comment has no region')
    }
    const updated = await updateCommentRegion(tx, comment.id, input.region)
    assertFound(updated, 'Comment not found')
    return updated
  })
}
export namespace setCommentRegion {
  export interface Input {
    buildId: string
    commentId: string
    userId: string
    /** Fractions of the screenshot: top-left corner and size. */
    region: { x: number; y: number; width: number; height: number }
  }
}
