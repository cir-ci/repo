import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { pairScreenshots, resolveBaseline } from '@circi/core'
import {
  completeBuild,
  type Database,
  getBuild,
  getFile,
  getProjectById,
  listBaselineCandidates,
  listBuildScreenshots,
  type NewDiff,
  replaceBuildDiffs,
  type Screenshot,
  setBuildBaseline,
  setFileDimensions,
  setScreenshotThumbnail,
  updateDiff,
  upsertServerFile,
} from '@circi/db'
import { diffImages, InvalidImageError, makeThumbnail, readPngInfo } from '@circi/diff'
import { contentKey, type StorageDriver } from '@circi/storage'

import { mapLimit } from './util.ts'

export interface ProcessDeps {
  db: Database
  storage: StorageDriver
  /** Parallel image operations per build. Each holds a few decoded screenshots in memory. */
  concurrency?: number
}

export type ProcessResult =
  | { status: 'skipped'; reason: string }
  | { status: 'complete'; conclusion: 'no_changes' | 'changes_detected'; autoApproved: boolean }

/**
 * Processes one build (PLAN §7.2–7.3): resolve the baseline, pair screenshots by name, diff the
 * pairs whose bytes differ, make thumbnails, then set the conclusion. Idempotent: a retried job
 * rebuilds the diff rows from scratch.
 */
export async function processBuild(deps: ProcessDeps, buildId: string): Promise<ProcessResult> {
  const { db, storage } = deps
  const concurrency = deps.concurrency ?? 4
  const build = await getBuild(db, buildId)
  if (!build) return { status: 'skipped', reason: 'build no longer exists' }
  if (build.status !== 'processing')
    return { status: 'skipped', reason: `build is ${build.status}` }
  const project = await getProjectById(db, build.projectId)
  if (!project) return { status: 'skipped', reason: 'project no longer exists' }

  // 1. Baseline.
  const candidates = await listBaselineCandidates(db, build)
  const resolution = resolveBaseline(
    { ancestorShas: build.ancestorShas, defaultBranch: project.defaultBranch },
    candidates,
  )
  const baseBuild = resolution.via === 'none' ? undefined : resolution.build
  await setBuildBaseline(db, build.id, {
    baseBuildId: baseBuild?.id ?? null,
    // M1 only receives history from CirCI's own CLI; Argos SDKs ('sdk') and git host
    // lookups ('provider') arrive in M3 and M2.5.
    baselineSource:
      resolution.via === 'ancestry' ? 'cli' : resolution.via === 'fallback' ? 'fallback' : 'none',
  })

  // 2. Pair by name.
  const head = await listBuildScreenshots(db, build.id)
  const base = baseBuild ? await listBuildScreenshots(db, baseBuild.id) : []
  const pairs = pairScreenshots(head, base)
  const rows: NewDiff[] = pairs.map((p) => ({
    buildId: build.id,
    name: p.name,
    headScreenshotId: 'head' in p ? p.head.id : null,
    baseScreenshotId: 'base' in p ? p.base.id : null,
    status: p.status === 'compare' ? null : p.status,
    score: p.status === 'unchanged' ? 0 : null,
    jobStatus: p.status === 'compare' ? 'pending' : 'done',
  }))
  await replaceBuildDiffs(db, build.id, rows)

  // 3. Thumbnails (and validation) for every head screenshot.
  const loader = createLoader(db, storage)
  const invalid = new Map<string, string>()
  await mapLimit(head, concurrency, async (shot) => {
    try {
      await thumbnailFor(db, storage, loader, shot)
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err
      invalid.set(shot.id, err.message)
    }
  })

  // 4. Pixel diffs for same-name pairs with different bytes.
  const diffRows = await db.query.screenshotDiffs.findMany({
    where: (d, { eq }) => eq(d.buildId, build.id),
  })
  const byName = new Map(diffRows.map((r) => [r.name, r]))
  const statuses: string[] = []
  await mapLimit(pairs, concurrency, async (pair) => {
    const row = byName.get(pair.name)
    if (!row) throw new Error(`diff row for ${pair.name} missing`)
    if (pair.status !== 'compare') {
      const headInvalid = 'head' in pair ? invalid.get(pair.head.id) : undefined
      if (headInvalid) {
        await updateDiff(db, row.id, { status: 'failed', errorMessage: headInvalid })
        statuses.push('failed')
      } else statuses.push(pair.status)
      return
    }
    const headInvalid = invalid.get(pair.head.id)
    if (headInvalid) {
      await updateDiff(db, row.id, {
        status: 'failed',
        jobStatus: 'failed',
        errorMessage: headInvalid,
      })
      statuses.push('failed')
      return
    }
    try {
      const [basePng, headPng] = await Promise.all([
        loader(pair.base.fileSha256),
        loader(pair.head.fileSha256),
      ])
      const res = await diffImages(basePng, headPng, { threshold: project.diffThreshold })
      let diffFileSha256: string | null = null
      if (res.diffPng) {
        diffFileSha256 = await storeServerFile(db, storage, res.diffPng, {
          kind: 'diff',
          contentType: 'image/png',
          width: res.width,
          height: res.height,
        })
      }
      const status = res.changed ? 'changed' : 'unchanged'
      await updateDiff(db, row.id, {
        status,
        score: res.score,
        changedPixels: res.changedPixels,
        sizeChanged: res.sizeChanged,
        diffFileSha256,
        jobStatus: 'done',
      })
      statuses.push(status)
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err
      await updateDiff(db, row.id, {
        status: 'failed',
        jobStatus: 'failed',
        errorMessage: err.message,
      })
      statuses.push('failed')
    }
  })

  // 5. Conclusion. Added, removed and unreadable screenshots all need a human look.
  const conclusion = statuses.every((s) => s === 'unchanged') ? 'no_changes' : 'changes_detected'
  const autoApprove =
    conclusion === 'changes_detected' &&
    project.autoApproveDefaultBranch &&
    build.prNumber === null &&
    build.branch === project.defaultBranch
  await completeBuild(db, build, { conclusion, autoApprove })
  return { status: 'complete', conclusion, autoApproved: autoApprove }
}

type Loader = (sha256: string) => Promise<Buffer>

/** Loads file bytes once per build, even when several pairs share a file. */
function createLoader(db: Database, storage: StorageDriver): Loader {
  const cache = new Map<string, Promise<Buffer>>()
  return (sha256) => {
    let p = cache.get(sha256)
    if (!p) {
      p = (async () => {
        const file = await getFile(db, sha256)
        if (!file) throw new Error(`file ${sha256} missing from the database`)
        return readAll(await storage.get(file.storageKey))
      })()
      cache.set(sha256, p)
    }
    return p
  }
}

async function thumbnailFor(
  db: Database,
  storage: StorageDriver,
  load: Loader,
  shot: Screenshot,
): Promise<void> {
  const png = await load(shot.fileSha256)
  const info = await readPngInfo(png)
  await setFileDimensions(db, shot.fileSha256, info)
  if (shot.thumbnailSha256) return
  const thumb = await makeThumbnail(png)
  const sha = await storeServerFile(db, storage, thumb.webp, {
    kind: 'thumbnail',
    contentType: 'image/webp',
    width: thumb.width,
    height: thumb.height,
  })
  await setScreenshotThumbnail(db, shot.id, sha)
}

/** Stores bytes the server made itself (diffs, thumbnails), deduplicated by hash. */
async function storeServerFile(
  db: Database,
  storage: StorageDriver,
  bytes: Buffer,
  meta: { kind: 'diff' | 'thumbnail'; contentType: string; width: number; height: number },
): Promise<string> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await getFile(db, sha256)
  if (existing?.status === 'verified') return sha256
  const key = existing?.storageKey ?? contentKey(sha256)
  await storage.put(key, bytes, { expectedSha256: sha256, contentType: meta.contentType })
  await upsertServerFile(db, {
    sha256,
    storageKey: key,
    kind: meta.kind,
    size: bytes.length,
    contentType: meta.contentType,
    width: meta.width,
    height: meta.height,
  })
  return sha256
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
