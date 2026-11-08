import type { Storage, Workspace } from '@circi/api'
import { updateWorkspace } from '@circi/auth'
import { ValidationError, workspacePurgeAt } from '@circi/core'
import {
  getMemberRole,
  getWorkspaceStorage,
  getWorkspaceBySlug,
  getWorkspaceSettings,
  NotFoundError,
  workspaceAcceptsSession,
  setWorkspaceSettings,
} from '@circi/db'
import { deleteWorkspace } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const body = z
  .object({ flakyBlocksMerge: z.boolean(), retentionDays: z.number() })
  .partial()
  .strict()
const deleteBody = z.object({ confirm: z.string().max(200) }).strict()
const generalBody = z
  .object({ name: z.string().max(100), slug: z.string().max(100) })
  .partial()
  .strict()

/**
 * A workspace's name and address, its defaults for its teams (flaky gate, retention) and its
 * storage usage. Members can see them, owners and admins change them; anyone outside the
 * workspace gets "not found".
 */
export const dashboardWorkspaceSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  async function load(req: FastifyRequest, reply: FastifyReply) {
    const { workspace: slug } = parse(params, req.params)
    const user = currentUser(req)
    const workspace = await getWorkspaceBySlug(deps.db, slug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const role = workspace
      ? await getMemberRole(deps.db, { userId: user.id, workspaceId: workspace.id })
      : undefined
    if (
      !workspace ||
      !role ||
      !(await workspaceAcceptsSession(deps.db, workspace.id, user.method))
    ) {
      await reply.code(404).send({ error: 'Workspace not found' })
      return undefined
    }
    return { workspace, role, canManage: role === 'owner' || role === 'admin' }
  }

  const MANAGE = 'Only owners and admins can change workspace settings'

  app.get('/workspaces/:workspace', async (req, reply): Promise<Workspace.General | void> => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      isOwner: found.role === 'owner',
      name: found.workspace.name,
      slug: found.workspace.slug,
    }
  })

  /** Renames the workspace and/or changes its address; the old address stops working. */
  app.patch('/workspaces/:workspace', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) return reply.code(403).send({ error: MANAGE })
    const patch = parse(generalBody, req.body)
    const updated = await updateWorkspace(deps.auth, deps.db, {
      workspaceId: found.workspace.id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.slug === undefined ? {} : { slug: patch.slug }),
    })
    return { name: updated.name, slug: updated.slug }
  })

  /** What the workspace's builds and hosted sites take up, by kind and by team. */
  app.get('/workspaces/:workspace/storage', async (req, reply): Promise<Storage.Usage | void> => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      ...(await getWorkspaceStorage(deps.db, found.workspace.id)),
    }
  })

  /**
   * Deletes the workspace (owners only), with its name typed as the confirmation. It disappears
   * at once, for everyone, and is purged after 30 days unless an instance admin restores it.
   */
  app.delete('/workspaces/:workspace', async (req, reply): Promise<Workspace.Deleted | void> => {
    const found = await load(req, reply)
    if (!found) return reply
    if (found.role !== 'owner') {
      return reply.code(403).send({ error: 'Only an owner can delete the workspace' })
    }
    const { confirm } = parse(deleteBody, req.body)
    if (confirm.trim() !== found.workspace.name) {
      throw new ValidationError('Type the workspace’s name to confirm')
    }
    const { deletedAt } = await deleteWorkspace(deps.db, {
      workspaceId: found.workspace.id,
      userId: currentUser(req).id,
    })
    return { purgeAt: workspacePurgeAt(deletedAt).toISOString() }
  })

  app.get('/workspaces/:workspace/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: await getWorkspaceSettings(deps.db, found.workspace.id),
    }
  })

  app.patch('/workspaces/:workspace/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) return reply.code(403).send({ error: MANAGE })
    const patch = parse(body, req.body)
    return { settings: await setWorkspaceSettings(deps.db, found.workspace.id, patch) }
  })
}
