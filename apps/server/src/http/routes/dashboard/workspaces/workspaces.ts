import { createWorkspace, createTeamWithToken } from '@circi/auth'
import {
  getLastWorkspaceSlug,
  listManageableWorkspaces,
  listRefusingWorkspaces,
  getIntegration,
  isFirstRunSetupPending,
  isInstanceAdmin,
} from '@circi/db/queries'
import { type SessionMethod } from '@circi/db/repositories'
import {
  integrationRegistry,
  mappingExtraSchema,
  normalizeExtra,
  type IntegrationDefinition,
} from '@circi/integrations'
import { mapTeam, rememberWorkspace } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const nameBody = z.object({ name: z.string().min(1).max(100) })
const teamBody = nameBody.extend({
  color: z.string().max(40).optional(),
  icon: z.string().max(40).nullable().optional(),
  defaultBranch: z.string().trim().min(1).max(255).optional(),
  /** Workspace members (user IDs) to add to the team; the person creating it is added anyway. */
  memberIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  /** A repository of one of the workspace's git integrations to point the team at. */
  repository: z
    .strictObject({
      integration: z.uuid(),
      ref: z.string().trim().min(1).max(1000),
      name: z.string().trim().min(1).max(200).optional(),
    })
    .optional(),
})
const workspaceParams = z.object({ workspace: z.string() })

/**
 * Creating workspaces and teams from the dashboard. Workspaces: instance admins, or
 * any member when `WORKSPACE_CREATION=anyone`. Teams: owners and admins of the workspace, who
 * get the team's CI token once, in the response.
 */
export const dashboardWorkspaceRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  async function canCreateWorkspace(user: { id: string; method: SessionMethod }): Promise<boolean> {
    // Someone signed in through a workspace's own provider belongs to that workspace only.
    if (typeof user.method === 'object' && 'scopedTo' in user.method) return false
    return deps.workspaceCreation === 'anyone' || (await isInstanceAdmin(deps.db, user.id))
  }

  app.get('/capabilities', async (req) => {
    const instanceAdmin = await isInstanceAdmin(deps.db, currentUser(req).id)
    return {
      /** Whether this person runs the instance (its admin pages). */
      instanceAdmin,
      /** First-run setup has steps left (the storage check, the first team); only the admin is shown them. */
      setupPending: instanceAdmin && (await isFirstRunSetupPending(deps.db)),
      canCreateWorkspace: await canCreateWorkspace(currentUser(req)),
      /** Workspaces that refuse the way this session signed in, and what they accept. */
      refusingWorkspaces: await listRefusingWorkspaces(
        deps.db,
        currentUser(req).id,
        currentUser(req).method,
        (deps.sso ?? []).map((p) => p.id),
      ),
      /** Whether the instance can send mail (SMTP is set up). */
      mailConfigured: deps.instance?.mailer !== undefined,
      /** The workspace this person opened last on any device, if they can still open it. */
      lastWorkspace: await getLastWorkspaceSlug(
        deps.db,
        currentUser(req).id,
        currentUser(req).method,
      ),
      /** Where this person may create teams. */
      manageableWorkspaces: await listManageableWorkspaces(
        deps.db,
        currentUser(req).id,
        currentUser(req).method,
      ),
    }
  })

  /**
   * Records that the person opened this workspace, so every device lands on it next. Members
   * only (anyone else gets the usual 404); writes nothing when it is already the remembered one.
   */
  app.put('/workspaces/:workspace/last-opened', async (req, reply) => {
    const { workspace, user } = await loadWorkspace(deps, req)
    await rememberWorkspace(deps.db, { userId: user.id, workspaceId: workspace.id })
    return reply.code(204).send()
  })

  app.post('/workspaces', async (req, reply) => {
    const user = currentUser(req)
    if (!(await canCreateWorkspace(user))) {
      return reply.code(403).send({ error: 'Only instance admins can create workspaces here' })
    }
    const { name } = parse(nameBody, req.body)
    const workspace = await createWorkspace(deps.auth, deps.db, { name, ownerEmail: user.email })
    return reply.code(201).send({ workspace: { slug: workspace.slug, name: workspace.name } })
  })

  app.post('/workspaces/:workspace/teams', async (req, reply) => {
    const { workspace: workspaceSlug } = parse(workspaceParams, req.params)
    const { name, color, icon, defaultBranch, repository, memberIds } = parse(teamBody, req.body)
    const { workspace } = await loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can create teams',
    })
    // The repository is checked before the team exists, so a bad one creates nothing.
    const registry = deps.integrations?.registry ?? integrationRegistry
    let mapping:
      | { definition: IntegrationDefinition; integrationId: string; ref: string; name: string }
      | undefined
    if (repository) {
      const integration = await getIntegration(deps.db, workspace.id, repository.integration)
      const definition = integration ? registry.get(integration.kind) : undefined
      const target = definition?.mapping?.target
      if (!integration || !definition || target?.kind !== 'repository' || target.resolve) {
        return reply.code(400).send({
          error: "That repository's integration isn't a git host connected to this workspace",
        })
      }
      const invalid = target.validate?.(repository.ref)
      if (invalid) return reply.code(400).send({ error: invalid })
      mapping = {
        definition,
        integrationId: integration.id,
        ref: repository.ref,
        name: repository.name ?? repository.ref,
      }
    }
    const { team, token } = await createTeamWithToken(deps.auth, deps.db, {
      workspaceSlug,
      name,
      createdBy: currentUser(req).id,
      ...(memberIds === undefined ? {} : { memberIds }),
      ...(defaultBranch === undefined ? {} : { defaultBranch }),
      ...(color === undefined ? {} : { color }),
      ...(icon === undefined ? {} : { icon }),
    })
    if (mapping) {
      // The same service the integration's PUT uses (exclusive hosts, attention, automatic links).
      await mapTeam(deps.db, {
        definition: mapping.definition,
        integrationId: mapping.integrationId,
        teamId: team.id,
        ref: mapping.ref,
        extra: {
          name: mapping.name,
          ...(mapping.definition.mapping
            ? normalizeExtra(
                mapping.definition.mapping,
                parse(mappingExtraSchema(mapping.definition.mapping), {}),
              )
            : {}),
        },
      })
    }
    return reply.code(201).send({
      team: { slug: team.slug, name: team.name, color: team.color, icon: team.icon },
      token,
    })
  })
}
