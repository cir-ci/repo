import { readFileSync } from 'node:fs'

import { detectCi } from './ci-env.ts'
import { UsageError } from './errors.ts'
import { type gitRunner, localHead } from './git.ts'

/**
 * What the CI says about this build, with the commit and branch taken from the checkout when it
 * says nothing; fails when no commit can be found either way.
 */
export async function buildContext(
  env: Record<string, string | undefined>,
  git: gitRunner.Runner,
): Promise<detectCi.Context & { commitSha: string }> {
  const ci = detectCi(env, (path) => JSON.parse(readFileSync(path, 'utf8')))
  if (!ci.commitSha || !ci.branch) {
    const local = await localHead(git)
    ci.commitSha ??= local.sha
    // A detached checkout reports no branch, so this only fills in a real one.
    if (!ci.branch && local.branch) ci.branch = local.branch
  }
  const { commitSha } = ci
  if (!commitSha) {
    throw new UsageError(
      'Could not determine the commit. Run inside a git checkout or set CIRCI_COMMIT.',
    )
  }
  return { ...ci, commitSha }
}
