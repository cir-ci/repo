import { upsertServerFile } from '#repositories/index.ts'
import * as schema from '#schema/index.ts'
import { type Database } from '#src/index.ts'

/** A verified file row (bytes are not stored; tests that need them use a storage driver). */
export async function seedFile(
  db: Database,
  input: {
    sha256: string
    kind?: 'screenshot' | 'thumbnail' | 'diff' | 'asset'
    width?: number
    height?: number
    size?: number
  },
): Promise<void> {
  await upsertServerFile(db, {
    sha256: input.sha256,
    storageKey: `k/${input.sha256}`,
    kind: input.kind ?? 'screenshot',
    size: input.size ?? 1,
    contentType: 'image/png',
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  })
}

/** A screenshot of `buildId`, creating its file (and thumbnail file) rows first. */
export async function seedScreenshot(
  db: Database,
  input: {
    buildId: string
    fileSha256: string
    thumbnailSha256?: string
    name?: string
    /** Stored sizes in bytes, for storage totals; 1 when unset. */
    size?: number
    thumbnailSize?: number
    width?: number
    height?: number
  },
) {
  await seedFile(db, {
    sha256: input.fileSha256,
    ...(input.size ? { size: input.size } : {}),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  })
  if (input.thumbnailSha256) {
    await seedFile(db, {
      sha256: input.thumbnailSha256,
      kind: 'thumbnail',
      ...(input.thumbnailSize ? { size: input.thumbnailSize } : {}),
    })
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
    diffFileSize?: number
    /**
     * The head image's hash: the build gets a screenshot with it (flakiness is about images, so
     * history without them says nothing), linked as the diff's head.
     */
    headSha256?: string
    score?: number
    sizeChanged?: boolean
    /** What an ignore region hid (Insights' ignore regions card). */
    ignoredChangedPixels?: number
    ignoredRegions?: string[]
  },
) {
  const head = input.headSha256
    ? await seedScreenshot(db, {
        buildId: input.buildId,
        name: input.name ?? 'home',
        fileSha256: input.headSha256,
      })
    : undefined
  if (input.diffFileSha256) {
    await seedFile(db, {
      sha256: input.diffFileSha256,
      kind: 'diff',
      ...(input.diffFileSize ? { size: input.diffFileSize } : {}),
    })
  }
  const [row] = await db
    .insert(schema.screenshotDiffs)
    .values({
      buildId: input.buildId,
      name: input.name ?? 'home',
      status: input.status ?? 'unchanged',
      jobStatus: 'done',
      ...(head ? { headScreenshotId: head.id } : {}),
      ...(input.score === undefined ? {} : { score: input.score }),
      ...(input.sizeChanged === undefined ? {} : { sizeChanged: input.sizeChanged }),
      ...(input.diffFileSha256 ? { diffFileSha256: input.diffFileSha256 } : {}),
      ...(input.ignoredChangedPixels === undefined
        ? {}
        : { ignoredChangedPixels: input.ignoredChangedPixels }),
      ...(input.ignoredRegions === undefined ? {} : { ignoredRegions: input.ignoredRegions }),
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
