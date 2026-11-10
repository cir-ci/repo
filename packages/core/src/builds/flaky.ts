/**
 * Flaky screenshots and the merge gate. The one rule for "is this screenshot flaky" lives here;
 * the flaky list, Triage, the sidebar count, Insights and the merge gate all feed it the same
 * history (`@circi/db`'s `loadFlakyHistory`) so they cannot disagree.
 *
 * A screenshot is flaky when its image on the team's default branch keeps coming back to
 * something it already was, or when the same commit rendered it differently on two runs. A
 * screenshot that was simply redesigned (A, then B, then C) is not flaky: it moved on, it
 * never came back. Whether a pull request whose only changes are flaky ones holds the merge is
 * a setting: the workspace sets it, and a team may override it.
 */

/** How many of the most recent default-branch commits the rule looks at. */
export const FLAKY_WINDOW = 10
/** The default number of flip-flops (`flakyAfterChanges`) before a screenshot is flaky. */
export const FLAKY_MIN_CHANGES = 3
/**
 * The fewest flip-flops a team may ask for. One return to an earlier image is what a normal
 * revert looks like; two is a pattern.
 */
export const MIN_FLAKY_FLIP_FLOPS = 2
/**
 * The most a team may ask for. In a window of `FLAKY_WINDOW` commits the first image cannot be a
 * return and the second cannot either, so more than window - 2 could never happen.
 */
export const MAX_FLAKY_FLIP_FLOPS = FLAKY_WINDOW - 2

/**
 * The effective "flaky screenshots block merges" value. The team's own value wins; `null`
 * means "inherit from the workspace".
 */
export function resolveFlakyBlocksMerge(workspace: boolean, team: boolean | null): boolean {
  return team ?? workspace
}

/** What a workspace says when it has never been asked: flaky changes block like any other. */
export const DEFAULT_FLAKY_BLOCKS_MERGE = true

/** One default-branch build's view of one screenshot name. */
export interface FlakyShot {
  /** The head image's file hash; null when the build has no image for the name (removed). */
  fileSha256: string | null
  /** The diff against the baseline; null when it was not compared or unchanged. */
  score: number | null
  sizeChanged: boolean
  /** The build's diff for the name has status `changed`. */
  changed: boolean
}

/** A completed default-branch build: its number, its commit and what it held for each name. */
export interface FlakyBuild {
  number: number
  commitSha: string
  shots: ReadonlyMap<string, FlakyShot>
}

/** Why a screenshot is flaky, and what the gate needs to recognise the same variation later. */
export interface FlakyVerdict {
  name: string
  /** Plain words for Triage, the baseline page and Insights, e.g. "came back to an earlier image 3 times". */
  reason: string
  /** Times a commit's image returned to one already seen in the window (A, B, A counts one). */
  flipFlops: number
  /** Commits with different images across their runs, and the most runs any one of them had. */
  disagreements: { commits: number; runs: number }
  /** In how many of the window's commits the screenshot showed as changed. */
  changedIn: number
  /** Every distinct image the screenshot had in the window. */
  knownImages: string[]
  /** The largest diff score seen for it in the window (0 when none was recorded). */
  largestScore: number
}

/** What the merge gate keeps of a verdict: enough to compare a pull request's change with it. */
export type FlakyGateEntry = Pick<FlakyVerdict, 'name' | 'reason' | 'knownImages' | 'largestScore'>

/** The flaky set a build was gated with, stored on the build when it finished. */
export interface FlakyDecision {
  /** Every change was a flaky screenshot and looked like its known variation. */
  flakyOnly: boolean
  /** The team's flaky screenshots among the builds before this one. */
  flaky: FlakyGateEntry[]
}

/** The last `window` distinct commits of `builds` (ordered by number), reruns kept together. */
export function lastCommits<T extends { number: number; commitSha: string }>(
  builds: readonly T[],
  window = FLAKY_WINDOW,
): { commitSha: string; runs: T[] }[] {
  const commits = new Map<string, T[]>()
  for (const b of builds.toSorted((a, c) => a.number - c.number)) {
    const runs = commits.get(b.commitSha)
    if (runs) runs.push(b)
    else commits.set(b.commitSha, [b])
  }
  return [...commits].slice(-window).map(([commitSha, runs]) => ({ commitSha, runs }))
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The reason in words: "came back to an earlier image 3 times", "differed across 2 runs of one commit". */
export function describeFlakyReason(v: {
  flipFlops: number
  disagreements: { commits: number; runs: number }
}): string {
  const parts: string[] = []
  const { commits, runs } = v.disagreements
  if (commits === 1) parts.push(`differed across ${runs} runs of one commit`)
  else if (commits > 1) parts.push(`differed across runs of ${commits} commits`)
  if (v.flipFlops > 0) {
    parts.push(
      `came back to an earlier image ${v.flipFlops === 1 ? 'once' : plural(v.flipFlops, 'time')}`,
    )
  }
  return parts.join(' and ')
}

/**
 * The screenshots that are flaky after `builds`, a team's completed default-branch builds up to
 * some moment. Only the last `window` distinct commits count; several runs of one commit are
 * one point in the sequence.
 *
 * - Flip-flops: walking the commits in order, a commit whose image differs from the one before
 *   it but equals an image seen earlier in the window is one flip-flop. A, B, A is one; A, B, A,
 *   B is two. Steady progressions (A, B, C, D) never count: nothing returned. The comparison is
 *   between consecutive default-branch commits' images, not against the baseline, so a change
 *   that nobody approved is not counted again by every later build.
 * - Rerun disagreement: two runs of the same commit that produced different images. Same code,
 *   same screenshot, different pixels: nondeterminism, the strongest signal, so one such commit
 *   is enough whatever the threshold.
 * - Otherwise flaky when the flip-flops reach `threshold` (the team's `flakyAfterChanges`, never
 *   below `MIN_FLAKY_FLIP_FLOPS`).
 *
 * Worst first (most commits with changes), then by name.
 */
export function flakyScreenshots(
  builds: readonly FlakyBuild[],
  options: { threshold: number; window?: number },
): FlakyVerdict[] {
  const commits = lastCommits(builds, options.window)
  const names = new Set<string>()
  for (const c of commits) {
    for (const r of c.runs) for (const name of r.shots.keys()) names.add(name)
  }
  const verdicts: FlakyVerdict[] = []
  for (const name of names) {
    const verdict = judgeFlaky(name, commits, options.threshold)
    if (verdict) verdicts.push(verdict)
  }
  return verdicts.toSorted((a, b) => b.changedIn - a.changedIn || a.name.localeCompare(b.name))
}

/** The rule for one name over the window's commits (see `flakyScreenshots`). */
export function judgeFlaky(
  name: string,
  commits: readonly { runs: readonly FlakyBuild[] }[],
  threshold: number,
): FlakyVerdict | null {
  const seen = new Set<string>()
  let previous: string | null = null
  let flipFlops = 0
  let disagreeingCommits = 0
  let mostRuns = 0
  let changedIn = 0
  let largestScore = 0
  for (const commit of commits) {
    const shots = commit.runs.flatMap((r) => {
      const shot = r.shots.get(name)
      return shot ? [shot] : []
    })
    if (shots.some((s) => s.changed)) changedIn += 1
    for (const s of shots) if (s.score !== null && s.score > largestScore) largestScore = s.score
    const images = shots.flatMap((s) => (s.fileSha256 === null ? [] : [s.fileSha256]))
    if (new Set(images).size > 1) {
      disagreeingCommits += 1
      mostRuns = Math.max(mostRuns, images.length)
    }
    const image = images.at(-1)
    if (image === undefined) continue
    if (previous !== null && image !== previous && seen.has(image)) flipFlops += 1
    previous = image
    for (const i of images) seen.add(i)
  }
  if (disagreeingCommits === 0 && flipFlops < Math.max(threshold, MIN_FLAKY_FLIP_FLOPS)) {
    return null
  }
  const disagreements = { commits: disagreeingCommits, runs: mostRuns }
  return {
    name,
    reason: describeFlakyReason({ flipFlops, disagreements }),
    flipFlops,
    disagreements,
    changedIn,
    knownImages: [...seen],
    largestScore,
  }
}

/** A pull request's change to one screenshot, as the gate compares it with known variation. */
export interface FlakyChange {
  name: string
  fileSha256: string | null
  score: number | null
  sizeChanged: boolean
}

/**
 * Whether a change looks like the variation already seen on the default branch: its image is
 * one the screenshot already had there, or it differs no more than the biggest wobble seen
 * there and the size stayed the same. A layout-breaking change on a flaky screenshot is
 * neither, so it still needs a person.
 */
export function looksLikeKnownVariation(
  change: Omit<FlakyChange, 'name'>,
  flaky: Pick<FlakyGateEntry, 'knownImages' | 'largestScore'>,
): boolean {
  if (change.fileSha256 !== null && flaky.knownImages.includes(change.fileSha256)) return true
  return !change.sizeChanged && change.score !== null && change.score <= flaky.largestScore
}

/**
 * Whether the build's only differences are known flaky variation: at least one change, nothing
 * added, removed or failed, and every changed screenshot is on the flaky list (computed from
 * the builds before this one) with a change that `looksLikeKnownVariation`.
 */
export function onlyFlakyChanges(input: onlyFlakyChanges.Input): boolean {
  const { added, removed, changed, failed } = input.counts
  if (changed === 0 || added > 0 || removed > 0 || failed > 0) return false
  if (input.changes.length === 0) return false
  const flaky = new Map(input.flaky.map((f) => [f.name, f]))
  return input.changes.every((c) => {
    const entry = flaky.get(c.name)
    return entry !== undefined && looksLikeKnownVariation(c, entry)
  })
}

export namespace onlyFlakyChanges {
  export interface Input {
    counts: { added: number; removed: number; changed: number; failed: number }
    /** The screenshots whose status is `changed`. */
    changes: readonly FlakyChange[]
    /** The team's flaky screenshots as of the builds before this one. */
    flaky: readonly FlakyGateEntry[]
  }
}
