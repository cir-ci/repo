import { buildOutcome } from '@circi/core'
import { type Build, type Database } from '@circi/db'
import { getProjectBuild, getProjectLink } from '@circi/db/queries'
import { getBuildCounts, listBuildDiffs } from '@circi/db/repositories'
import { integrationRegistry } from '@circi/integrations'

import { gateInputs } from '#src/builds/gate.ts'

/**
 * What CI polls (PLAN §7.4): the build's outcome and who blocks the merge: the check on the git
 * host when this project reports to one, otherwise this CI job. `gate` overrides the choice (the
 * CLI's `--gate`). `undefined` when the project has no such build.
 */
export async function getBuildStatus(
  db: Database,
  input: getBuildStatus.Input,
): Promise<getBuildStatus.Result | undefined> {
  const build = await getProjectBuild(db, input.projectId, input.buildId)
  if (!build) return undefined
  const linked =
    input.gitHostReports &&
    (await getProjectLink(db, input.projectId, integrationRegistry.gitKinds()))
  const counts = await getBuildCounts(db, build.id)
  // Which screenshots the server couldn't read and why, so a CI log can name them.
  const unreadable =
    counts.failed > 0
      ? (await listBuildDiffs(db, build.id))
          .filter((d) => d.status === 'failed')
          .map((d) => ({ name: d.name, reason: d.errorMessage ?? "Couldn't read this image" }))
          .toSorted((a, b) => a.name.localeCompare(b.name))
      : []
  return {
    build,
    counts,
    unreadable,
    outcome: buildOutcome({ ...build, ...(await gateInputs(db, build)) }),
    gate: input.gate ?? (linked ? 'status' : 'exit-code'),
  }
}

export namespace getBuildStatus {
  export type Gate = 'status' | 'exit-code'

  export interface Input {
    projectId: string
    buildId: string
    gate?: Gate | undefined
    /** The git host app is installed on this server, so a linked project gets its check there. */
    gitHostReports: boolean
  }

  export interface Result {
    build: Build
    counts: Awaited<ReturnType<typeof getBuildCounts>>
    /** The screenshots that couldn't be read, by name, with the reason; empty when none. */
    unreadable: { name: string; reason: string }[]
    outcome: ReturnType<typeof buildOutcome>
    gate: Gate
  }
}
