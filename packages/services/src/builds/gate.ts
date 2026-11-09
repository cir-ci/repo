import { resolveFlakyBlocksMerge, assertFound } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getWorkspaceSettings, getTeamById } from '@circi/db/queries'
import { buildChangesAreFlakyOnly } from '@circi/db/repositories'

/**
 * What decides a build's merge gate besides the build itself: the team's blocking switch,
 * whether flaky screenshots block (the team's own value, else the workspace's), and whether
 * this build's only changes are flaky ones. Read when the gate is evaluated (the status endpoint,
 * the git notice), so a changed setting applies to the next evaluation of an existing build.
 */
export async function gateInputs(
  db: Database,
  build: Pick<Build, 'id' | 'teamId' | 'status' | 'conclusion' | 'reviewStatus'>,
): Promise<gateInputs.Result> {
  const team = await getTeamById(db, build.teamId)
  assertFound(team, 'Team not found')
  const workspace = await getWorkspaceSettings(db, team.workspaceId)
  const flakyBlocksMerge = resolveFlakyBlocksMerge(
    workspace.flakyBlocksMerge,
    team.flakyBlocksMerge,
  )
  // Only a finished, unreviewed build with changes can be held, so only then look at flakiness.
  const reviewable =
    build.status === 'complete' &&
    build.conclusion === 'changes_detected' &&
    build.reviewStatus === 'pending'
  return {
    blockMergeOnChanges: team.blockMergeOnChanges,
    flakyBlocksMerge,
    flakyOnly: reviewable && !flakyBlocksMerge ? await buildChangesAreFlakyOnly(db, build) : false,
  }
}

export namespace gateInputs {
  export interface Result {
    blockMergeOnChanges: boolean
    /** The effective setting for this team. */
    flakyBlocksMerge: boolean
    /** Every change in the build is a flaky screenshot. Only looked up when it can matter. */
    flakyOnly: boolean
  }
}
