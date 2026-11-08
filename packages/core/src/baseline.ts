/**
 * Baseline resolution (PLAN §7.2): which earlier build a new build is compared against.
 *
 * Pure function over candidates the caller has already narrowed to the same team and the
 * same build name, excluding the build being resolved. Kept free of I/O so it can be tested
 * exhaustively; getting this wrong is the fastest way for a visual testing tool to lose trust.
 */

/**
 * A build can serve as a baseline when it finished, and either someone (or auto-approve)
 * approved it, or it had no changes against its own approved baseline and wasn't rejected.
 * Without the second rule, no-change builds would never become baselines when auto-approve
 * is off, and comparisons would drift further and further back.
 */
export function isEligibleBaseline(c: resolveBaseline.Candidate): boolean {
  if (c.status !== 'complete') return false
  if (c.reviewStatus === 'approved') return true
  return c.conclusion === 'no_changes' && c.reviewStatus !== 'rejected'
}

export function resolveBaseline<C extends resolveBaseline.Candidate>(
  input: resolveBaseline.Input,
  candidates: readonly C[],
): resolveBaseline.Resolution<C> {
  const eligible = candidates.filter(isEligibleBaseline)
  if (eligible.length === 0) return { via: 'none' }

  // Several eligible builds on one commit happen with CI re-runs; the newest wins.
  const newestByCommit = new Map<string, C>()
  for (const c of eligible) {
    const current = newestByCommit.get(c.commitSha)
    if (!current || c.createdAt > current.createdAt) newestByCommit.set(c.commitSha, c)
  }

  for (const sha of input.ancestorShas) {
    const build = newestByCommit.get(sha)
    if (build) return { via: 'ancestry', build, matchedCommit: sha }
  }

  let fallback: C | undefined
  for (const c of eligible) {
    if (c.branch !== input.defaultBranch) continue
    if (!fallback || c.createdAt > fallback.createdAt) fallback = c
  }
  return fallback ? { via: 'fallback', build: fallback } : { via: 'none' }
}

export namespace resolveBaseline {
  export interface Candidate {
    id: string
    commitSha: string
    branch: string | null
    status: string
    reviewStatus: string
    conclusion: string | null
    createdAt: Date
  }

  export interface Input {
    /** Commits to walk, nearest first: the merge-base onwards for PRs, HEAD~1 onwards on the default branch. */
    ancestorShas: readonly string[]
    defaultBranch: string
  }

  export type Resolution<C extends Candidate = Candidate> =
    | { via: 'ancestry'; build: C; matchedCommit: string }
    | { via: 'fallback'; build: C }
    | { via: 'none' }
}
