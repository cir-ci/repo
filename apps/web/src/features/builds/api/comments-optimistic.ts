import type { Comment } from '@circi/api'

/** The comment as the thread shows it before the server has answered (its ID is replaced on refetch). */
export function pendingComment(
  input: Comment.Create,
  author: Comment.Author | null,
  id: string,
  now: Date,
): Comment.Item {
  return {
    id,
    parentId: input.parentId ?? null,
    snapshotName: input.snapshotName ?? null,
    region: input.region ?? null,
    regionSide: input.regionSide ?? 'current',
    body: input.body,
    author,
    createdAt: now.toISOString(),
    editedAt: null,
    deletedAt: null,
    mine: true,
    canDelete: true,
  }
}

/** The thread list with a new comment at the end (oldest first). */
export const withComment = (list: Comment.List, comment: Comment.Item): Comment.List => ({
  comments: [...list.comments, comment],
})

/** A comment as deleted: its body goes and its thread keeps its shape, as the server does. */
export const withDeletedComment = (list: Comment.List, id: string, now: Date): Comment.List => ({
  comments: list.comments.map((c) =>
    c.id === id ? { ...c, body: '', deletedAt: now.toISOString() } : c,
  ),
})

/** A comment's new text. */
export const withEditedComment = (
  list: Comment.List,
  id: string,
  body: string,
  now: Date,
): Comment.List => ({
  comments: list.comments.map((c) =>
    c.id === id ? { ...c, body, editedAt: now.toISOString() } : c,
  ),
})
