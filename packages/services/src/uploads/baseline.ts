import { COMMIT_SHA_RE } from '@circi/core'
import { type Database, findBaselineByCommits } from '@circi/db'

/**
 * The baseline an SDK that found the commit history itself asks for. `commits` starts with the
 * commit itself; the baseline is searched among its ancestors (the rest, nearest first, ignoring
 * anything that is not a commit SHA).
 */
export async function findBaseline(
  db: Database,
  input: { teamId: string; name: string; commits: string[] },
) {
  return findBaselineByCommits(db, {
    teamId: input.teamId,
    name: input.name,
    commits: input.commits
      .slice(1)
      .filter((c) => COMMIT_SHA_RE.test(c))
      .map((c) => c.toLowerCase()),
  })
}
