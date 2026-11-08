import {
  createIntegration,
  type Database,
  findIntegrationByExternalId,
  getProjectById,
  NotFoundError,
  setIntegrationAttention,
  unlinkProject,
} from '@circi/db'
import { integrationRegistry } from '@circi/integrations'

import { gitKinds } from './git-kinds.ts'
import { mapProject } from './integration-links.ts'

/**
 * Linking a project to a GitHub repository without going through the integration's page: the
 * project settings and `circi-admin github link`. The installation becomes the organisation's
 * GitHub integration if it is not one yet (the caller vouches for the installation id: the page
 * path verifies it with GitHub), and the project's repository is its mapping on it.
 */

export namespace linkProjectToGithub {
  export interface Input {
    installationId: string
    repoRef: string
  }
}

export async function linkProjectToGithub(
  db: Database,
  projectId: string,
  link: linkProjectToGithub.Input,
): Promise<void> {
  const project = await getProjectById(db, projectId)
  if (!project) throw new NotFoundError('Project not found')
  const definition = integrationRegistry.get('github')
  if (!definition) throw new Error('GitHub is not registered')
  await db.transaction(async (tx) => {
    const existing = await findIntegrationByExternalId(
      tx,
      project.orgId,
      'github',
      link.installationId,
    )
    const integrationId =
      existing?.id ??
      (
        await createIntegration(tx, {
          orgId: project.orgId,
          kind: 'github',
          displayName: `Installation ${link.installationId}`,
          externalId: link.installationId,
        })
      ).id
    // Linking again is how someone says "I reinstalled the App": try afresh.
    await setIntegrationAttention(tx, integrationId, null)
    await mapProject(tx, {
      definition,
      integrationId,
      projectId,
      ref: link.repoRef,
      extra: { name: link.repoRef },
    })
  })
}

/** Stops a project reporting to its git host (the connection stays). */
export async function unlinkProjectFromGit(db: Database, projectId: string): Promise<void> {
  await unlinkProject(db, projectId, gitKinds())
}
