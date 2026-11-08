import { type Database, schema, upsertServerFile } from '@circi/db'

/** A verified file row (bytes are not stored; tests that need them use a storage driver). */
export async function seedFile(
  db: Database,
  input: {
    sha256: string
    kind?: 'screenshot' | 'thumbnail' | 'diff' | 'asset'
    width?: number
    height?: number
  },
): Promise<void> {
  await upsertServerFile(db, {
    sha256: input.sha256,
    storageKey: `k/${input.sha256}`,
    kind: input.kind ?? 'screenshot',
    size: 1,
    contentType: 'image/png',
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  })
}

/** A screenshot of `buildId`, creating its file (and thumbnail file) rows first. */
export async function seedScreenshot(
  db: Database,
  input: { buildId: string; fileSha256: string; thumbnailSha256?: string; name?: string },
) {
  await seedFile(db, { sha256: input.fileSha256 })
  if (input.thumbnailSha256) {
    await seedFile(db, { sha256: input.thumbnailSha256, kind: 'thumbnail' })
  }
  const [row] = await db
    .insert(schema.screenshots)
    .values({
      buildId: input.buildId,
      name: input.name ?? 'home',
      fileSha256: input.fileSha256,
      ...(input.thumbnailSha256 ? { thumbnailSha256: input.thumbnailSha256 } : {}),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A finished comparison row of `buildId`; `diffFileSha256` gets its file row created. */
export async function seedDiff(
  db: Database,
  input: {
    buildId: string
    name?: string
    status?: 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'
    diffFileSha256?: string
  },
) {
  if (input.diffFileSha256) await seedFile(db, { sha256: input.diffFileSha256, kind: 'diff' })
  const [row] = await db
    .insert(schema.screenshotDiffs)
    .values({
      buildId: input.buildId,
      name: input.name ?? 'home',
      status: input.status ?? 'unchanged',
      jobStatus: 'done',
      ...(input.diffFileSha256 ? { diffFileSha256: input.diffFileSha256 } : {}),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A claim that `buildId` uses the file `fileSha256` (the file row must exist). */
export async function seedUploadClaim(
  db: Database,
  input: { buildId: string; fileSha256: string },
): Promise<void> {
  await db.insert(schema.uploadClaims).values(input)
}
