import { pairScreenshots, resolveBaseline } from '@circi/core'
import { type Database, type NewScreenshotDiff, type Screenshot } from '@circi/db'
import { getBuild, getTeamById } from '@circi/db/queries'
import {
  findApprovedRerunOf,
  ignoreRegionsByName,
  listBaselineCandidates,
  listBuildDiffs,
  listBuildScreenshots,
  replaceBuildDiffs,
  setBuildBaseline,
  setFileDimensions,
  setScreenshotThumbnail,
  updateDiff,
} from '@circi/db/repositories'
import {
  InvalidImageError,
  type diffImages,
  type makeThumbnail,
  type readPngInfo,
} from '@circi/diff'
import type { StorageDriver } from '@circi/storage'

import { completeBuild } from '#src/builds/lifecycle.ts'

import { mapLimit } from './concurrency.ts'
import { createLoader, type Loader, storeServerFile } from './files.ts'

/** The build pipeline (PLAN §7.2–7.3), run by the worker's `process-build` job. */

export namespace processBuild {
  export interface Deps {
    db: Database
    storage: StorageDriver
    /** The image functions of `@circi/diff`, passed in so tests can fake them. */
    diff: {
      diffImages: typeof diffImages
      makeThumbnail: typeof makeThumbnail
      readPngInfo: typeof readPngInfo
    }
    /** Parallel image operations per build. Each holds a few decoded screenshots in memory. */
    concurrency?: number
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    | { status: 'complete'; conclusion: 'no_changes' | 'changes_detected'; autoApproved: boolean }
}

/**
 * Processes one build (PLAN §7.2–7.3): resolve the baseline, pair screenshots by name, diff the
 * pairs whose bytes differ, make thumbnails, then set the conclusion. Idempotent: a retried job
 * rebuilds the diff rows from scratch.
 */
export async function processBuild(
  deps: processBuild.Deps,
  buildId: string,
): Promise<processBuild.Result> {
  const { db, storage, diff } = deps
  const concurrency = deps.concurrency ?? 4
  const build = await getBuild(db, buildId)
  if (!build) return { status: 'skipped', reason: 'build no longer exists' }
  if (build.status !== 'processing')
    return { status: 'skipped', reason: `build is ${build.status}` }
  const team = await getTeamById(db, build.teamId)
  if (!team) return { status: 'skipped', reason: 'team no longer exists' }

  // 1. Baseline.
  const candidates = await listBaselineCandidates(db, build)
  const resolution = resolveBaseline(
    { ancestorShas: build.ancestorShas, defaultBranch: team.defaultBranch },
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
  // A snapshot approved (or rejected) on its own can have a better baseline than the build's:
  // compare each such name against the build `resolveBaseline` picks for that name alone.
  const decidedNames = new Set(
    candidates.flatMap((c) => [...c.approvedSnapshots, ...c.rejectedSnapshots]),
  )
  const shotsByBuild = new Map<string, Screenshot[]>()
  for (const shot of head) {
    if (!decidedNames.has(shot.name)) continue
    const own = resolveBaseline(
      { ancestorShas: build.ancestorShas, defaultBranch: team.defaultBranch },
      candidates,
      shot.name,
    )
    const ownBuild = own.via === 'none' ? undefined : own.build
    if (ownBuild?.id === baseBuild?.id) continue
    const at = base.findIndex((b) => b.name === shot.name)
    if (at >= 0) base.splice(at, 1)
    if (!ownBuild) continue
    let shots = shotsByBuild.get(ownBuild.id)
    if (!shots) {
      // oxlint-disable-next-line no-await-in-loop -- one lookup per distinct build, usually none
      shots = await listBuildScreenshots(db, ownBuild.id)
      shotsByBuild.set(ownBuild.id, shots)
    }
    const found = shots.find((b) => b.name === shot.name)
    if (found) base.push(found)
  }
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
      await thumbnailFor(db, storage, diff, loader, shot)
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err
      invalid.set(shot.id, err.message)
    }
  })

  // 4. Pixel diffs for same-name pairs with different bytes.
  const diffRows = await listBuildDiffs(db, build.id)
  const ignored = await ignoreRegionsByName(db, build.teamId)
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
      const res = await diff.diffImages(basePng, headPng, {
        threshold: team.diffThreshold,
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
  // no baseline (a team's first) is never auto-approved: someone reviews every screenshot once.
  const conclusion = statuses.every((s) => s === 'unchanged') ? 'no_changes' : 'changes_detected'
  let approval: completeBuild.Approval = 'none'
  if (conclusion === 'changes_detected') {
    if (
      baseBuild !== undefined &&
      team.autoApproveDefaultBranch &&
      build.prNumber === null &&
      build.branch === team.defaultBranch
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
  diff: processBuild.Deps['diff'],
  load: Loader,
  shot: Screenshot,
): Promise<void> {
  const png = await load(shot.fileSha256)
  const info = await diff.readPngInfo(png)
  await setFileDimensions(db, shot.fileSha256, info)
  if (shot.thumbnailSha256) return
  const thumb = await diff.makeThumbnail(png)
  const sha = await storeServerFile(db, storage, thumb.webp, {
    kind: 'thumbnail',
    contentType: 'image/webp',
    width: thumb.width,
    height: thumb.height,
  })
  await setScreenshotThumbnail(db, shot.id, sha)
}
