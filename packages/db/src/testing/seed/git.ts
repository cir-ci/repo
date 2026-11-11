import { getProjectById } from '#queries/index.ts'
import {
  createIntegration,
  findIntegrationByExternalId,
  removeOtherProjectMappings,
  setIntegrationAttention,
  setIntegrationProject,
} from '#repositories/index.ts'
import { type Database } from '#src/index.ts'

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

/** Points a project at a repository on a git host connection of its workspace (made if needed). */
export async function seedGitLink(
  db: Database,
  projectId: string,
  input: {
    kind?: string
    externalId: string
    repoRef: string
    encryptedCredentials?: string | null
    /** Like mapping through `mapProject`: the project's mappings on other git hosts go. Default true. */
    exclusive?: boolean
  },
): Promise<{ integrationId: string }> {
  const project = await getProjectById(db, projectId)
  if (!project) throw new Error('Project not found')
  const connection = await seedGitConnection(db, {
    ...input,
    workspaceId: project.workspaceId,
  })
  await setIntegrationProject(db, {
    integrationId: connection.id,
    projectId,
    externalRef: input.repoRef,
    extra: { name: input.repoRef },
  })
  // What mapping a project to a git host does (`mapProject` in @circi/services): one git host per project,
  // and mapping says the connection works.
  if (input.exclusive !== false) {
    await removeOtherProjectMappings(db, {
      projectId,
      keepIntegrationId: connection.id,
      kinds: ['github', 'gitlab', 'bitbucket'],
    })
  }
  await setIntegrationAttention(db, connection.id, null)
  return { integrationId: connection.id }
}
