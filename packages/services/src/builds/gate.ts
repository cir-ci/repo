import { resolveFlakyBlocksMerge, assertFound } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getWorkspaceSettings, getProjectById } from '@circi/db/queries'
import { buildFlakyDecision, getBuildCounts } from '@circi/db/repositories'

/**
 * What decides a build's merge gate besides the build itself: the project's blocking switch,
 * whether flaky screenshots block (the project's own value, else the workspace's), and whether
 * this build's only changes are known flaky variation. Read when the gate is evaluated (the
 * status endpoint, the git notice), so a changed setting applies to the next evaluation of an
 * existing build.
 *
 * The flaky part is a recorded decision: the build keeps the flaky set the gate used when it
 * finished (`builds.flaky_decision`, from the builds before it), so the check run and the status
 * endpoint always answer the same, and a later default-branch build that changes the project's
 * flaky list does not flip a pull request that was already gated; a rerun gets a new decision.
 * Builds that finished before decisions were recorded are decided now, from the builds before
 * them, which gives the same answer every time.
 */
export async function gateInputs(
  db: Database,
  build: Pick<
    Build,
    'id' | 'projectId' | 'number' | 'status' | 'conclusion' | 'reviewStatus' | 'flakyDecision'
  >,
): Promise<gateInputs.Result> {
  const project = await getProjectById(db, build.projectId)
  assertFound(project, 'Project not found')
  const workspace = await getWorkspaceSettings(db, project.workspaceId)
  const flakyBlocksMerge = resolveFlakyBlocksMerge(
    workspace.flakyBlocksMerge,
    project.flakyBlocksMerge,
  )
  // Only a finished, unreviewed build with changes can be held, so only then look at flakiness.
  const reviewable =
    build.status === 'complete' &&
    build.conclusion === 'changes_detected' &&
    build.reviewStatus === 'pending'
  return {
    unreadable:
      build.status === 'complete' && build.conclusion === 'changes_detected'
        ? (await getBuildCounts(db, build.id)).failed
        : 0,
    blockMergeOnChanges: project.blockMergeOnChanges,
    autoApproveNoChanges: project.autoApproveNoChanges,
    flakyBlocksMerge,
    flakyOnly: reviewable ? (await decisionOf(db, build)).flakyOnly : false,
  }
}

/** The recorded decision, or (for a build that finished before they were recorded) a fresh one. */
async function decisionOf(db: Database, build: Parameters<typeof gateInputs>[1]) {
  return build.flakyDecision ?? (await buildFlakyDecision(db, build))
}

export namespace gateInputs {
  export interface Result {
    /** Screenshots the server couldn't read: the build can't pass while there are any. */
    unreadable: number
    blockMergeOnChanges: boolean
    /** Whether a build with no changes passes on its own. */
    autoApproveNoChanges: boolean
    /** The effective setting for this project. */
    flakyBlocksMerge: boolean
    /** Every change in the build is a flaky screenshot that looks like its known variation. */
    flakyOnly: boolean
  }
}
