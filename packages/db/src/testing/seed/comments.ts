import { eq } from 'drizzle-orm'

import * as schema from '#schema/index.ts'
import { type Comment, type Database } from '#src/index.ts'

import { nextCreatedAt } from '../created-at.ts'

export namespace seedComment {
  export interface Input {
    buildId: string
    authorId: string | null
    /** Defaults to the author's current name. */
    authorName?: string | null
    body?: string
    snapshotName?: string | null
    region?: { x: number; y: number; width: number; height: number } | null
    parentId?: string | null
    createdAt?: Date
    editedAt?: Date | null
    deletedAt?: Date | null
  }
}

/** A comment inserted as given (any time or state), without mentions or notices. */
export async function seedComment(db: Database, input: seedComment.Input): Promise<Comment> {
  const [author] = input.authorId
    ? await db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, input.authorId))
    : []
  const [row] = await db
    .insert(schema.comments)
    .values({
      buildId: input.buildId,
      authorId: input.authorId,
      authorName: input.authorName !== undefined ? input.authorName : (author?.name ?? null),
      body: input.body ?? 'Looks off',
      snapshotName: input.snapshotName ?? null,
      regionX: input.region?.x ?? null,
      regionY: input.region?.y ?? null,
      regionWidth: input.region?.width ?? null,
      regionHeight: input.region?.height ?? null,
      parentId: input.parentId ?? null,
      editedAt: input.editedAt ?? null,
      deletedAt: input.deletedAt ?? null,
      createdAt: input.createdAt ?? nextCreatedAt(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
