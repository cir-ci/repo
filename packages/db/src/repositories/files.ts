import { SHA256_RE } from '@circi/core'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { type FileKind, files, uploadClaims } from '../schema/index.ts'
import type { FileRow } from '../types.ts'

/** Content-addressed files: upload planning (verify before dedup, PLAN §8) and bookkeeping. */

/**
 * Decides which files a build must upload (PLAN §7.1 step 4, §8 "verify before dedup").
 *
 * - A hash with a **verified** row is deduplicated: no upload, and an upload claim is recorded
 *   in the same transaction, under `FOR SHARE`, so GC can't delete the file before finalize.
 * - Any other hash (no row, or a row still `pending`) must be uploaded. Pending hashes are never
 *   deduplicated: nobody has proven those bytes exist yet.
 */
export async function planUploads(
  db: Database,
  input: {
    buildId: string
    kind: FileKind
    files: planUploads.File[]
    storageKeyFor: (sha256: string) => string
  },
): Promise<planUploads.Planned[]> {
  const requested = new Map<string, planUploads.File>()
  for (const f of input.files) {
    if (!SHA256_RE.test(f.sha256)) throw new Error(`Invalid sha256: ${f.sha256}`)
    requested.set(f.sha256, f)
  }
  if (requested.size === 0) return []
  const shas = [...requested.keys()]

  return db.transaction(async (tx) => {
    const verified = await tx
      .select({ sha256: files.sha256 })
      .from(files)
      .where(and(inArray(files.sha256, shas), eq(files.status, 'verified')))
      .for('share')
    const verifiedSet = new Set(verified.map((r) => r.sha256))

    if (verifiedSet.size > 0) {
      await tx
        .insert(uploadClaims)
        .values([...verifiedSet].map((fileSha256) => ({ buildId: input.buildId, fileSha256 })))
        .onConflictDoNothing()
    }

    const missing = shas.filter((sha) => !verifiedSet.has(sha))
    if (missing.length === 0) return []

    await tx
      .insert(files)
      .values(
        missing.map((sha) => {
          const f = requested.get(sha)
          return {
            sha256: sha,
            storageKey: input.storageKeyFor(sha),
            kind: input.kind,
            size: f?.size ?? null,
            contentType: f?.contentType ?? null,
          }
        }),
      )
      .onConflictDoNothing()

    // Re-read: a concurrent build may have created (or verified) some rows meanwhile.
    const rows = await tx
      .select({ sha256: files.sha256, storageKey: files.storageKey, status: files.status })
      .from(files)
      .where(inArray(files.sha256, missing))
    const planned: planUploads.Planned[] = []
    const lateVerified: string[] = []
    for (const r of rows) {
      if (r.status === 'verified') {
        lateVerified.push(r.sha256)
        continue
      }
      const f = requested.get(r.sha256)
      planned.push({
        sha256: r.sha256,
        storageKey: r.storageKey,
        size: f?.size ?? 0,
        contentType: f?.contentType ?? 'application/octet-stream',
      })
    }
    // Every file the build asked for is claimed by it: that keeps it from being collected, and
    // it's what lets this build (and only it) upload bytes for a file the server doesn't have yet.
    const claimed = [...lateVerified, ...planned.map((p) => p.sha256)]
    if (claimed.length > 0) {
      await tx
        .insert(uploadClaims)
        .values(claimed.map((fileSha256) => ({ buildId: input.buildId, fileSha256 })))
        .onConflictDoNothing()
    }
    return planned
  })
}

export namespace planUploads {
  export interface File {
    sha256: string
    size: number
    contentType: string
  }

  export interface Planned {
    sha256: string
    storageKey: string
    size: number
    contentType: string
  }
}

export async function getFile(db: Database, sha256: string): Promise<FileRow | undefined> {
  const [row] = await db.select().from(files).where(eq(files.sha256, sha256))
  return row
}

/** Marks a file verified once its bytes are proven to match its hash. Idempotent. */
export async function markFileVerified(
  db: Database,
  sha256: string,
  details: { size: number; contentType?: string },
): Promise<void> {
  await db
    .update(files)
    .set({
      status: 'verified',
      verifiedAt: new Date(),
      size: details.size,
      gcMarkedAt: null,
      ...(details.contentType ? { contentType: details.contentType } : {}),
    })
    .where(and(eq(files.sha256, sha256), eq(files.status, 'pending')))
}

/** Records image dimensions once the worker has read the bytes. Never taken from clients. */
export async function setFileDimensions(
  db: Database,
  sha256: string,
  dims: { width: number; height: number },
): Promise<void> {
  await db
    .update(files)
    .set(dims)
    .where(and(eq(files.sha256, sha256), isNull(files.width)))
}

/**
 * Inserts a worker-made file (diff image, thumbnail) whose bytes are already stored and hashed
 * by the server itself, so it's verified from the start. Returns the storage key to use, which
 * is the existing one when the same bytes were stored before.
 */
export async function upsertServerFile(
  db: Database,
  input: {
    sha256: string
    storageKey: string
    kind: FileKind
    size: number
    contentType: string
    width?: number
    height?: number
  },
): Promise<{ storageKey: string; created: boolean }> {
  const inserted = await db
    .insert(files)
    .values({
      sha256: input.sha256,
      storageKey: input.storageKey,
      kind: input.kind,
      status: 'verified',
      verifiedAt: new Date(),
      size: input.size,
      contentType: input.contentType,
      width: input.width ?? null,
      height: input.height ?? null,
    })
    .onConflictDoNothing()
    .returning({ storageKey: files.storageKey })
  if (inserted[0]) return { storageKey: inserted[0].storageKey, created: true }
  const existing = await getFile(db, input.sha256)
  if (!existing) throw new Error(`file ${input.sha256} vanished`)
  return { storageKey: existing.storageKey, created: false }
}

/** Whether `buildId` asked for this file, which is what lets it upload the bytes. */
export async function hasUploadClaim(
  db: Database,
  buildId: string,
  sha256: string,
): Promise<boolean> {
  const [row] = await db
    .select({ sha: uploadClaims.fileSha256 })
    .from(uploadClaims)
    .where(and(eq(uploadClaims.buildId, buildId), eq(uploadClaims.fileSha256, sha256)))
  return row !== undefined
}
