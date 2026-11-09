import { buildOutcome } from '@circi/core'
import { type Build, type Database, getBuildCounts, getTeamBuild, getTeamLink } from '@circi/db'

import { gateInputs } from '#src/gate.ts'
import { gitKinds } from '#src/git-kinds.ts'

/**
 * What CI polls (PLAN §7.4): the build's outcome and who blocks the merge: the check on the git
 * host when this team reports to one, otherwise this CI job. `gate` overrides the choice (the
 * CLI's `--gate`). `undefined` when the team has no such build.
 */
export async function getBuildStatus(
  db: Database,
  input: getBuildStatus.Input,
): Promise<getBuildStatus.Result | undefined> {
  const build = await getTeamBuild(db, input.teamId, input.buildId)
  if (!build) return undefined
  const linked = input.gitHostReports && (await getTeamLink(db, input.teamId, gitKinds()))
  return {
    build,
    counts: await getBuildCounts(db, build.id),
    outcome: buildOutcome({ ...build, ...(await gateInputs(db, build)) }),
    gate: input.gate ?? (linked ? 'status' : 'exit-code'),
  }
}

export namespace getBuildStatus {
  export type Gate = 'status' | 'exit-code'

  export interface Input {
    teamId: string
    buildId: string
    gate?: Gate | undefined
    /** The git host app is installed on this server, so a linked team gets its check there. */
    gitHostReports: boolean
  }

  export interface Result {
    build: Build
    counts: Awaited<ReturnType<typeof getBuildCounts>>
    outcome: ReturnType<typeof buildOutcome>
    gate: Gate
  }
}
