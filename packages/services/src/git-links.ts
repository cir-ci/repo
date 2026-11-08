import {
  createIntegration,
  type Database,
  findIntegrationByExternalId,
  getTeamById,
  isAccountClaimedElsewhere,
  NotFoundError,
  setIntegrationAttention,
  unlinkTeam,
} from '@circi/db'
import {
  type IntegrationDefinition,
  IntegrationConflictError,
  integrationRegistry,
  InvalidInputError,
} from '@circi/integrations'

import { gitKinds } from './git-kinds.ts'
import { mapTeam } from './integration-links.ts'

/**
 * Linking a team to a GitHub repository without going through the integration's page: the
 * team settings and `circi admin github link`. The installation is verified with GitHub first,
 * exactly as the Add flow does (`connect` of the GitHub definition: a token is minted and the
 * repositories listed, so the App must really be installed there), and no other workspace of the
 * instance may use it. It then becomes the workspace's GitHub integration if it is not one yet,
 * and the team's repository is its mapping on it. Nothing is stored when any step fails; the
 * errors are the definition's (`IntegrationError`: 400 not an installation of this App, 404 no
 * such installation, 409 another workspace's, 502 GitHub did not answer).
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
  ctx: IntegrationDefinition.Context,
): Promise<void> {
  const team = await getTeamById(db, teamId)
  if (!team) throw new NotFoundError('Team not found')
  const definition = integrationRegistry.get('github')
  if (!definition?.connect) throw new Error('GitHub is not registered')
  if (definition.available && !definition.available(ctx)) {
    throw new InvalidInputError('This instance has no GitHub App configured')
  }
  const parsed = definition.credentials.safeParse({ installationId: link.installationId })
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Invalid installation id')
  }
  // Asks GitHub before anything is written.
  const connected = await definition.connect(parsed.data, ctx)
  await db.transaction(async (tx) => {
    if (await isAccountClaimedElsewhere(tx, 'github', connected.externalId, team.workspaceId)) {
      throw new IntegrationConflictError(
        `That ${definition.name} account is already connected to another workspace`,
      )
    }
    const existing = await findIntegrationByExternalId(
      tx,
      team.workspaceId,
      'github',
      connected.externalId,
    )
    const integrationId =
      existing?.id ??
      (
        await createIntegration(tx, {
          workspaceId: team.workspaceId,
          kind: 'github',
          displayName: connected.displayName,
          externalId: connected.externalId,
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
