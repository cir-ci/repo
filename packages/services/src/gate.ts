import { resolveFlakyBlocksMerge } from '@circi/core'
import {
  type Build,
  buildChangesAreFlakyOnly,
  type Database,
  getOrgSettings,
  getProjectById,
  NotFoundError,
} from '@circi/db'

/**
 * What decides a build's merge gate besides the build itself: the project's blocking switch,
 * whether flaky screenshots block (the project's own value, else the organization's), and whether
 * this build's only changes are flaky ones. Read when the gate is evaluated (the status endpoint,
 * the git notice), so a changed setting applies to the next evaluation of an existing build.
 */
export async function gateInputs(
  db: Database,
  build: Pick<Build, 'id' | 'projectId' | 'status' | 'conclusion' | 'reviewStatus'>,
): Promise<gateInputs.Result> {
  const project = await getProjectById(db, build.projectId)
  if (!project) throw new NotFoundError('Project not found')
  const org = await getOrgSettings(db, project.orgId)
  const flakyBlocksMerge = resolveFlakyBlocksMerge(org.flakyBlocksMerge, project.flakyBlocksMerge)
  // Only a finished, unreviewed build with changes can be held, so only then look at flakiness.
  const reviewable =
    build.status === 'complete' &&
    build.conclusion === 'changes_detected' &&
    build.reviewStatus === 'pending'
  return {
    blockMergeOnChanges: project.blockMergeOnChanges,
    flakyBlocksMerge,
    flakyOnly: reviewable && !flakyBlocksMerge ? await buildChangesAreFlakyOnly(db, build) : false,
  }
}

export namespace gateInputs {
  export interface Result {
    blockMergeOnChanges: boolean
    /** The effective setting for this project. */
    flakyBlocksMerge: boolean
    /** Every change in the build is a flaky screenshot. Only looked up when it can matter. */
    flakyOnly: boolean
  }
}
