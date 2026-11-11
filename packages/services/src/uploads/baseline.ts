import { COMMIT_SHA_RE } from '@circi/core'
import { type Database } from '@circi/db'
import { findBaselineByCommits } from '@circi/db/repositories'

/**
 * The baseline an SDK that found the commit history itself asks for. `commits` starts with the
 * commit itself; the baseline is searched among its ancestors (the rest, nearest first, ignoring
 * anything that is not a commit SHA).
 */
export async function findBaseline(
  db: Database,
  input: { projectId: string; name: string; commits: string[] },
) {
  return findBaselineByCommits(db, {
    projectId: input.projectId,
    name: input.name,
    commits: input.commits
      .slice(1)
      .filter((c) => COMMIT_SHA_RE.test(c))
      .map((c) => c.toLowerCase()),
  })
}
