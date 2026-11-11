import { assertFound } from '@circi/core'
import { type Database } from '@circi/db'
import { getProjectById } from '@circi/db/queries'
import { unlinkProject } from '@circi/db/queue'
import {
  createIntegration,
  findIntegrationByExternalId,
  isAccountClaimedElsewhere,
  setIntegrationAttention,
} from '@circi/db/repositories'
import {
  type IntegrationDefinition,
  IntegrationConflictError,
  integrationRegistry,
  InvalidInputError,
} from '@circi/integrations'

import { mapProject } from '#src/integration-admin/links.ts'

/**
 * Linking a project to a GitHub repository without going through the integration's page: the
 * project settings and `circi admin github link`. The installation is verified with GitHub first,
 * exactly as the Add flow does (`connect` of the GitHub definition: a token is minted and the
 * repositories listed, so the App must really be installed there), and no other workspace of the
 * instance may use it. It then becomes the workspace's GitHub integration if it is not one yet,
 * and the project's repository is its mapping on it. Nothing is stored when any step fails; the
 * errors are the definition's (`IntegrationError`: 400 not an installation of this App, 404 no
 * such installation, 409 another workspace's, 502 GitHub did not answer).
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
  ctx: IntegrationDefinition.Context,
): Promise<void> {
  const project = await getProjectById(db, projectId)
  assertFound(project, 'Project not found')
  const definition = integrationRegistry.get('github')
  if (!definition?.connect) throw new Error('GitHub is not registered')
  if (definition.available && !definition.available(ctx)) {
    throw new InvalidInputError('This instance has no GitHub App configured')
  }
  const parsed = definition.credentials.safeParse({ installationId: link.installationId })
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.issues[0]?.message ?? 'Invalid installation ID')
  }
  // Asks GitHub before anything is written.
  const connected = await definition.connect(parsed.data, ctx)
  await db.transaction(async (tx) => {
    if (await isAccountClaimedElsewhere(tx, 'github', connected.externalId, project.workspaceId)) {
      throw new IntegrationConflictError(
        `That ${definition.name} account is already connected to another workspace`,
      )
    }
    const existing = await findIntegrationByExternalId(
      tx,
      project.workspaceId,
      'github',
      connected.externalId,
    )
    const integrationId =
      existing?.id ??
      (
        await createIntegration(tx, {
          workspaceId: project.workspaceId,
          kind: 'github',
          displayName: connected.displayName,
          externalId: connected.externalId,
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
  await unlinkProject(db, projectId, integrationRegistry.gitKinds())
}
