import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { createdAt, inList } from './_columns.ts'
import { builds } from './builds.ts'
import { FILE_KINDS, FILE_STATUSES, type FileKind, type FileStatus } from './enums.ts'

/** Stored bytes, and the claims that keep GC away from files an upload is relying on. */

/** Content-addressed blobs shared across builds and workspaces (PLAN §8 "verify before dedup"). */
export const files = pgTable(
  'files',
  {
    sha256: text('sha256').primaryKey(),
    /** `ab/cd/<sha256>/<generation-uuid>`; a new generation after GC never collides with a delete. */
    storageKey: text('storage_key').notNull().unique(),
    kind: text('kind').$type<FileKind>().notNull(),
    status: text('status').$type<FileStatus>().notNull().default('pending'),
    size: bigint('size', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    contentType: text('content_type'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    gcMarkedAt: timestamp('gc_marked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('files_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_kind_check', inList('kind', FILE_KINDS)),
    check('files_status_check', inList('status', FILE_STATUSES)),
    check('files_verified_check', sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`),
    index('files_gc_marked_idx')
      .on(t.gcMarkedAt)
      .where(sql`${t.gcMarkedAt} is not null`),
  ],
)

/** "The server told this upload it already has the file" — GC treats it as a reference. */
export const uploadClaims = pgTable(
  'upload_claims',
  {
    buildId: uuid('build_id')
      .notNull()
      .references(() => builds.id, { onDelete: 'cascade' }),
    fileSha256: text('file_sha256')
      .notNull()
      .references(() => files.sha256, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.buildId, t.fileSha256] }),
    index('upload_claims_file_idx').on(t.fileSha256),
  ],
)
