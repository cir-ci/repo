import {
  createIntegration,
  type Database,
  findIntegrationByExternalId,
  getProjectById,
  setIntegrationProject,
} from '@circi/db'

/**
 * A git host connection of an organisation (an `integrations` row), the way connecting one leaves
 * it. Connecting the same account again returns the same integration.
 */
export async function seedGitConnection(
  db: Database,
  input: {
    orgId: string
    kind?: string
    externalId: string
    encryptedCredentials?: string | null
  },
): Promise<{ id: string }> {
  const kind = input.kind ?? 'github'
  const existing = await findIntegrationByExternalId(db, input.orgId, kind, input.externalId)
  if (existing) return existing
  return createIntegration(db, {
    orgId: input.orgId,
    kind,
    displayName: kind === 'github' ? `Installation ${input.externalId}` : input.externalId,
    externalId: input.externalId,
    encryptedCredentials: input.encryptedCredentials ?? null,
  })
}

/** Points a project at a repository on a git host connection of its organisation (made if needed). */
export async function seedGitLink(
  db: Database,
  projectId: string,
  input: {
    kind?: string
    externalId: string
    repoRef: string
    encryptedCredentials?: string | null
  },
): Promise<{ integrationId: string }> {
  const project = await getProjectById(db, projectId)
  if (!project) throw new Error('Project not found')
  const connection = await seedGitConnection(db, { ...input, orgId: project.orgId })
  await setIntegrationProject(db, {
    integrationId: connection.id,
    projectId,
    externalRef: input.repoRef,
    extra: { name: input.repoRef },
  })
  return { integrationId: connection.id }
}
