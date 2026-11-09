import { asc, eq } from 'drizzle-orm'

import { comments, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** The comments of a build, shaped for the dashboard. */

export interface CommentItem {
  id: string
  parentId: string | null
  snapshotName: string | null
  region: { x: number; y: number; width: number; height: number } | null
  /** The image of the snapshot the region is on. */
  regionSide: 'baseline' | 'current'
  /** Empty for a deleted comment. */
  body: string
  /** Null when the author's account was deleted. */
  author: { id: string; name: string } | null
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
}

/** All of a build's comments, oldest first; deleted ones stay as blank placeholders. */
export async function listBuildComments(db: Database, buildId: string): Promise<CommentItem[]> {
  const rows = await db
    .select({ comment: comments, authorName: user.name })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(eq(comments.buildId, buildId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
  return rows.map(({ comment: c, authorName }) => ({
    id: c.id,
    parentId: c.parentId,
    snapshotName: c.snapshotName,
    region:
      c.regionX === null || c.regionY === null || c.regionWidth === null || c.regionHeight === null
        ? null
        : { x: c.regionX, y: c.regionY, width: c.regionWidth, height: c.regionHeight },
    regionSide: c.regionSide,
    body: c.deletedAt ? '' : c.body,
    author: c.authorId && authorName !== null ? { id: c.authorId, name: authorName } : null,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    deletedAt: c.deletedAt,
  }))
}
