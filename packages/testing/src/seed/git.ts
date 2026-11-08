import {
  createIntegration,
  type Database,
  findIntegrationByExternalId,
  getTeamById,
  removeOtherTeamMappings,
  setIntegrationAttention,
  setIntegrationTeam,
} from '@circi/db'

/**
 * A git host connection of a workspace (an `integrations` row), the way connecting one leaves
 * it. Connecting the same account again returns the same integration.
 */
export async function seedGitConnection(
  db: Database,
  input: {
    workspaceId: string
    kind?: string
    externalId: string
    encryptedCredentials?: string | null
  },
): Promise<{ id: string }> {
  const kind = input.kind ?? 'github'
  const existing = await findIntegrationByExternalId(db, input.workspaceId, kind, input.externalId)
  if (existing) return existing
  return createIntegration(db, {
    workspaceId: input.workspaceId,
    kind,
    displayName: kind === 'github' ? `Installation ${input.externalId}` : input.externalId,
    externalId: input.externalId,
    encryptedCredentials: input.encryptedCredentials ?? null,
  })
}

/** Points a team at a repository on a git host connection of its workspace (made if needed). */
export async function seedGitLink(
  db: Database,
  teamId: string,
  input: {
    kind?: string
    externalId: string
    repoRef: string
    encryptedCredentials?: string | null
    /** Like mapping through `mapTeam`: the team's mappings on other git hosts go. Default true. */
    exclusive?: boolean
  },
): Promise<{ integrationId: string }> {
  const team = await getTeamById(db, teamId)
  if (!team) throw new Error('Team not found')
  const connection = await seedGitConnection(db, {
    ...input,
    workspaceId: team.workspaceId,
  })
  await setIntegrationTeam(db, {
    integrationId: connection.id,
    teamId,
    externalRef: input.repoRef,
    extra: { name: input.repoRef },
  })
  // What mapping a team to a git host does (`mapTeam` in @circi/services): one git host per team,
  // and mapping says the connection works.
  if (input.exclusive !== false) {
    await removeOtherTeamMappings(db, {
      teamId,
      keepIntegrationId: connection.id,
      kinds: ['github', 'gitlab', 'bitbucket'],
    })
  }
  await setIntegrationAttention(db, connection.id, null)
  return { integrationId: connection.id }
}
