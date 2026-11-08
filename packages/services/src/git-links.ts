import {
  createIntegration,
  type Database,
  findIntegrationByExternalId,
  getTeamById,
  NotFoundError,
  setIntegrationAttention,
  unlinkTeam,
} from '@circi/db'
import { integrationRegistry } from '@circi/integrations'

import { gitKinds } from './git-kinds.ts'
import { mapTeam } from './integration-links.ts'

/**
 * Linking a team to a GitHub repository without going through the integration's page: the
 * team settings and `circi-admin github link`. The installation becomes the workspace's
 * GitHub integration if it is not one yet (the caller vouches for the installation id: the page
 * path verifies it with GitHub), and the team's repository is its mapping on it.
 */

export namespace linkTeamToGithub {
  export interface Input {
    installationId: string
    repoRef: string
  }
}

export async function linkTeamToGithub(
  db: Database,
  teamId: string,
  link: linkTeamToGithub.Input,
): Promise<void> {
  const team = await getTeamById(db, teamId)
  if (!team) throw new NotFoundError('Team not found')
  const definition = integrationRegistry.get('github')
  if (!definition) throw new Error('GitHub is not registered')
  await db.transaction(async (tx) => {
    const existing = await findIntegrationByExternalId(
      tx,
      team.workspaceId,
      'github',
      link.installationId,
    )
    const integrationId =
      existing?.id ??
      (
        await createIntegration(tx, {
          workspaceId: team.workspaceId,
          kind: 'github',
          displayName: `Installation ${link.installationId}`,
          externalId: link.installationId,
        })
      ).id
    // Linking again is how someone says "I reinstalled the App": try afresh.
    await setIntegrationAttention(tx, integrationId, null)
    await mapTeam(tx, {
      definition,
      integrationId,
      teamId,
      ref: link.repoRef,
      extra: { name: link.repoRef },
    })
  })
}

/** Stops a team reporting to its git host (the connection stays). */
export async function unlinkTeamFromGit(db: Database, teamId: string): Promise<void> {
  await unlinkTeam(db, teamId, gitKinds())
}
