import { pairScreenshots, resolveBaseline } from '@circi/core'
import {
  type Database,
  type NewScreenshotDiff,
  type Screenshot,
  type ScreenshotDiff,
} from '@circi/db'
import { getBuild, getProjectById } from '@circi/db/queries'
import {
  buildFlakyDecision,
  copyFileThumbnailsToScreenshots,
  findDecidedRerunOf,
  ignoreRegionsByName,
  listBaselineCandidates,
  listBuildDiffs,
  listBuildScreenshots,
  listFilesWithoutThumbnail,
  replaceBuildDiffs,
  setBuildBaseline,
  type setBuildResult,
  setFileThumbnail,
  updateDiffs,
  type DiffResult,
} from '@circi/db/repositories'
import {
  InvalidImageError,
  type DiffEngine,
  type diffImages,
  type makeThumbnail,
  type readPngInfo,
} from '@circi/diff'
import type { StorageDriver } from '@circi/storage'

import { completeBuild, failBuild } from '#src/builds/lifecycle.ts'

import { mapLimit } from './concurrency.ts'
import { createFetcher, createLoader, type Loader, storeServerFile } from './files.ts'

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
    /** Pixel comparison engine passed to `diffImages` (default `js`). */
    diffEngine?: DiffEngine
    /** Parallel image operations per build. Each holds a few decoded screenshots in memory. */
    concurrency?: number
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    /** A screenshot's file isn't a readable PNG: the build is an error, naming the files. */
    | { status: 'error'; message: string }
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
  // A snapshot approved (or rejected) on its own can have a better baseline than the build's:
  // compare each such name against the build `resolveBaseline` picks for that name alone.
  const decidedNames = new Set(
    candidates.flatMap((c) => [...c.approvedSnapshots, ...c.rejectedSnapshots]),
  )
  const shotsByBuild = new Map<string, Screenshot[]>()
  for (const shot of head) {
    if (!decidedNames.has(shot.name)) continue
    const own = resolveBaseline(
      { ancestorShas: build.ancestorShas, defaultBranch: project.defaultBranch },
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

  // 3. Thumbnails (and validation), once per distinct file that has none yet. A thumbnail and
  // the dimensions belong to the content-addressed file, so a screenshot whose bytes were seen in
  // any earlier build costs no download and no encode; the screenshots then copy them in SQL.
  const fetchFile = createFetcher(db, storage)
  const invalid = new Map<string, string>() // by file hash
  const needThumbnail = await listFilesWithoutThumbnail(db, [
    ...new Set(head.map((s) => s.fileSha256)),
  ])
  await mapLimit(needThumbnail, concurrency, async (sha) => {
    try {
      await thumbnailFor(db, storage, diff, fetchFile, sha)
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err
      invalid.set(sha, err.message)
    }
  })
  // A file nobody can decode is a problem with the upload, not a screenshot to review: the build
  // ends as an error that names the files (the CLI prints it and exits 2).
  if (invalid.size > 0) {
    const message = unreadableMessage(head, invalid)
    await failBuild(db, build.id, message)
    return { status: 'error', message }
  }
  await copyFileThumbnailsToScreenshots(db, build.id)

  // 4. Pixel diffs for same-name pairs with different bytes. Outcomes are collected and written
  // in set-based batches; the bytes of a file are dropped after the last pair that reads it.
  const diffRows = await listBuildDiffs(db, build.id)
  const ignored = await ignoreRegionsByName(db, build.projectId)
  const byName = new Map(diffRows.map((r) => [r.name, r]))
  const uses = new Map<string, number>()
  for (const pair of pairs) {
    if (pair.status !== 'compare') continue
    for (const sha of [pair.base.fileSha256, pair.head.fileSha256])
      uses.set(sha, (uses.get(sha) ?? 0) + 1)
  }
  const loader = createLoader(db, storage, uses)
  const statuses: string[] = []
  const results: DiffResult[] = []
  await mapLimit(pairs, concurrency, async (pair) => {
    const row = byName.get(pair.name)
    if (!row) throw new Error(`diff row for ${pair.name} missing`)
    const fail = (message: string, jobStatus: DiffResult['jobStatus']) => {
      results.push({ ...resultOf(row), status: 'failed', errorMessage: message, jobStatus })
      statuses.push('failed')
    }
    if (pair.status !== 'compare') {
      statuses.push(pair.status)
      return
    }
    try {
      const [basePng, headPng] = await Promise.all([
        loader(pair.base.fileSha256),
        loader(pair.head.fileSha256),
      ])
      const res = await diff.diffImages(basePng, headPng, {
        threshold: project.diffThreshold,
        ...(deps.diffEngine ? { engine: deps.diffEngine } : {}),
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
      const regions = ignored.get(pair.name) ?? []
      results.push({
        ...resultOf(row),
        status,
        score: res.score,
        changedPixels: res.changedPixels,
        // What the ignore regions hid, for Insights: a region has no name of its own, so it is
        // labelled by its screenshot (and its position among several).
        ignoredChangedPixels: res.ignoredChangedPixels,
        ignoredRegions: res.ignoredRegions.map((i) =>
          regions.length === 1 ? pair.name : `${pair.name} #${i + 1}`,
        ),
        sizeChanged: res.sizeChanged,
        diffFileSha256,
        jobStatus: 'done',
      })
      statuses.push(status)
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err
      fail(err.message, 'failed')
    } finally {
      loader.release(pair.base.fileSha256)
      loader.release(pair.head.fileSha256)
    }
  })
  await updateDiffs(db, results)

  // 5. Conclusion. Added, removed and unreadable screenshots all need a human look. A build with
  // no baseline (a project's first) is never auto-approved: someone reviews every screenshot once.
  const conclusion = statuses.every((s) => s === 'unchanged') ? 'no_changes' : 'changes_detected'
  // The flaky set the merge gate will use, decided now from the builds before this one and kept
  // on the build, so a later default-branch build changing the list never flips this build's check.
  const flakyDecision =
    conclusion === 'changes_detected' ? await buildFlakyDecision(db, build) : undefined
  const decided = flakyDecision ? { flakyDecision } : {}
  let outcome: setBuildResult.Input = { conclusion, approval: 'none', ...decided }
  if (conclusion === 'changes_detected') {
    if (
      baseBuild !== undefined &&
      project.autoApproveDefaultBranch &&
      build.prNumber === null &&
      build.branch === project.defaultBranch
    ) {
      outcome = { conclusion, approval: 'default-branch', ...decided }
    } else {
      // A CI re-run of a commit whose exact screenshots someone already decided on: approved
      // stays approved, rejected stays rejected, until someone decides again or an image changes.
      const earlier = await findDecidedRerunOf(db, build)
      if (earlier?.state === 'approved') outcome = { conclusion, approval: 'rerun', ...decided }
      else if (earlier) {
        outcome = { conclusion, approval: 'rerun-rejected', carriedFrom: earlier.id, ...decided }
      }
    }
  }
  await completeBuild(db, build, outcome)
  return {
    status: 'complete',
    conclusion,
    autoApproved: outcome.approval === 'default-branch' || outcome.approval === 'rerun',
  }
}

/** "Couldn't read 2 screenshots: a, b (Not a readable image…)": the first few names, then a count. */
function unreadableMessage(head: readonly Screenshot[], invalid: ReadonlyMap<string, string>) {
  const names = [...new Set(head.filter((s) => invalid.has(s.fileSha256)).map((s) => s.name))]
  const shown = names.slice(0, 5).join(', ')
  const more = names.length > 5 ? ` and ${names.length - 5} more` : ''
  const reason = [...invalid.values()][0] ?? ''
  const noun = names.length === 1 ? 'screenshot' : 'screenshots'
  return `Couldn't read ${names.length} ${noun}: ${shown}${more}. ${reason}`
}

/** The row's own columns as a result, so a batch update leaves what it doesn't change alone. */
function resultOf(row: ScreenshotDiff): DiffResult {
  return {
    id: row.id,
    status: row.status,
    score: row.score,
    changedPixels: row.changedPixels,
    ignoredChangedPixels: row.ignoredChangedPixels,
    ignoredRegions: row.ignoredRegions,
    sizeChanged: row.sizeChanged,
    diffFileSha256: row.diffFileSha256,
    jobStatus: row.jobStatus,
    errorMessage: row.errorMessage,
  }
}

async function thumbnailFor(
  db: Database,
  storage: StorageDriver,
  diff: processBuild.Deps['diff'],
  fetchFile: Loader,
  sha256: string,
): Promise<void> {
  const png = await fetchFile(sha256)
  const info = await diff.readPngInfo(png)
  const thumb = await diff.makeThumbnail(png)
  const thumbnailSha256 = await storeServerFile(db, storage, thumb.webp, {
    kind: 'thumbnail',
    contentType: 'image/webp',
    width: thumb.width,
    height: thumb.height,
  })
  await setFileThumbnail(db, sha256, { thumbnailSha256, width: info.width, height: info.height })
}
