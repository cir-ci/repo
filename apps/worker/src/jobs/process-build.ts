import { pairScreenshots, resolveBaseline } from '@circi/core'
import {
  type Database,
  getBuild,
  findApprovedRerunOf,
  getProjectById,
  ignoreRegionsByName,
  listBaselineCandidates,
  listBuildDiffs,
  listBuildScreenshots,
  type NewScreenshotDiff,
  replaceBuildDiffs,
  type Screenshot,
  setBuildBaseline,
  setFileDimensions,
  setScreenshotThumbnail,
  updateDiff,
} from '@circi/db'
import { diffImages, InvalidImageError, makeThumbnail, readPngInfo } from '@circi/diff'
import { completeBuild } from '@circi/services'
import type { StorageDriver } from '@circi/storage'

import { mapLimit } from '../lib/concurrency.ts'
import { createLoader, type Loader, storeServerFile } from '../lib/files.ts'

/** The `process-build` job (PLAN §7.2–7.3). */

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
    // The history came from our CLI or from an Argos SDK, whichever created the build.
    baselineSource:
      resolution.via === 'ancestry'
        ? build.historySource
        : resolution.via === 'fallback'
          ? 'fallback'
          : 'none',
  })

  // 2. Pair by name.
  const head = await listBuildScreenshots(db, build.id)
  const base = baseBuild ? await listBuildScreenshots(db, baseBuild.id) : []
  const pairs = pairScreenshots(head, base)
  const rows: NewScreenshotDiff[] = pairs.map((p) => ({
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
  const diffRows = await listBuildDiffs(db, build.id)
  const ignored = await ignoreRegionsByName(db, build.projectId)
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
      const res = await diffImages(basePng, headPng, {
        threshold: project.diffThreshold,
        ...(ignored.has(pair.name) ? { ignore: ignored.get(pair.name) ?? [] } : {}),
      })
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

  // 5. Conclusion. Added, removed and unreadable screenshots all need a human look. A build with
  // no baseline (a project's first) is never auto-approved: someone reviews every screenshot once.
  const conclusion = statuses.every((s) => s === 'unchanged') ? 'no_changes' : 'changes_detected'
  let approval: completeBuild.Approval = 'none'
  if (conclusion === 'changes_detected') {
    if (
      baseBuild !== undefined &&
      project.autoApproveDefaultBranch &&
      build.prNumber === null &&
      build.branch === project.defaultBranch
    ) {
      approval = 'default-branch'
    } else if (await findApprovedRerunOf(db, build)) {
      // A CI re-run of a commit whose exact screenshots someone already approved.
      approval = 'rerun'
    }
  }
  await completeBuild(db, build, { conclusion, approval })
  return { status: 'complete', conclusion, autoApproved: approval !== 'none' }
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
