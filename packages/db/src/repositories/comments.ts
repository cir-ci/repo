import { and, asc, eq, isNull } from 'drizzle-orm'

import { builds, comments, member, teamMembers, teams, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Comment } from '#src/types.ts'

/** Comments on builds: plain storage. Mentions and their notices are `@circi/services`. */

export async function insertComment(db: Database, input: insertComment.Input): Promise<Comment> {
  const region = input.region
  const [row] = await db
    .insert(comments)
    .values({
      buildId: input.buildId,
      snapshotName: input.snapshotName ?? null,
      regionX: region?.x ?? null,
      regionY: region?.y ?? null,
      regionWidth: region?.width ?? null,
      regionHeight: region?.height ?? null,
      regionSide: input.regionSide ?? 'current',
      body: input.body,
      authorId: input.authorId,
      parentId: input.parentId ?? null,
    })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return row
}
export namespace insertComment {
  export interface Input {
    buildId: string
    authorId: string
    body: string
    snapshotName?: string | null
    /** Fractions of the snapshot: top-left corner and size. */
    region?: { x: number; y: number; width: number; height: number } | null
    /** The image the region is drawn on; 'current' when omitted. */
    regionSide?: 'baseline' | 'current'
    parentId?: string | null
  }
}

export async function getComment(db: Database, id: string): Promise<Comment | undefined> {
  const [row] = await db.select().from(comments).where(eq(comments.id, id))
  return row
}

/** Rewrites a live comment's text; returns undefined when it is gone or deleted. */
export async function updateCommentBody(
  db: Database,
  id: string,
  body: string,
): Promise<Comment | undefined> {
  const [row] = await db
    .update(comments)
    .set({ body, editedAt: new Date() })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning()
  return row
}

/** Moves a live comment's region (fractions of the snapshot); returns undefined when it is gone or deleted. */
export async function updateCommentRegion(
  db: Database,
  id: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<Comment | undefined> {
  const [row] = await db
    .update(comments)
    .set({
      regionX: region.x,
      regionY: region.y,
      regionWidth: region.width,
      regionHeight: region.height,
    })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning()
  return row
}

/** Soft-deletes a comment; returns undefined when it is gone or already deleted. */
export async function softDeleteComment(db: Database, id: string): Promise<Comment | undefined> {
  const [row] = await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .returning()
  return row
}

export interface WorkspaceMember {
  userId: string
  name: string
  email: string
}

/** The members of a build's team, for matching @mentions. */
export async function listBuildTeamMembers(
  db: Database,
  buildId: string,
): Promise<WorkspaceMember[]> {
  return db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(builds)
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .innerJoin(
      member,
      and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, teamMembers.userId)),
    )
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(builds.id, buildId))
    .orderBy(asc(user.id))
}
