import type { Storage, Workspace } from '@circi/api'
import { updateWorkspace } from '@circi/auth'
import { ValidationError, workspacePurgeAt } from '@circi/core'
import {
  getWorkspaceStorage,
  getWorkspaceSettings,
  listTeamFlakyOverrides,
} from '@circi/db/queries'
import { deleteWorkspace, isWorkspaceOwner, updateWorkspaceSettings } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

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
  const MANAGE = 'Only owners and admins can change workspace settings'

  app.get('/workspaces/:workspace', async (req): Promise<Workspace.General | void> => {
    const found = await loadWorkspace(deps, req)
    return {
      canManage: found.canManage,
      isOwner: isWorkspaceOwner(found),
      name: found.workspace.name,
      slug: found.workspace.slug,
    }
  })

  /** Renames the workspace and/or changes its address; the old address stops working. */
  app.patch('/workspaces/:workspace', async (req) => {
    const found = await loadWorkspace(deps, req, { manage: true, forbidden: MANAGE })
    const patch = parse(generalBody, req.body)
    const updated = await updateWorkspace(deps.auth, deps.db, {
      workspaceId: found.workspace.id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.slug === undefined ? {} : { slug: patch.slug }),
    })
    return { name: updated.name, slug: updated.slug }
  })

  /** What the workspace's builds and hosted sites take up, by kind and by team. */
  app.get('/workspaces/:workspace/storage', async (req): Promise<Storage.Usage | void> => {
    const found = await loadWorkspace(deps, req)
    return {
      canManage: found.canManage,
      ...(await getWorkspaceStorage(deps.db, found.workspace.id)),
    }
  })

  /**
   * Deletes the workspace (owners only), with its address (slug) typed as the confirmation. It disappears
   * at once, for everyone, and is purged after 30 days unless an instance admin restores it.
   */
  app.delete('/workspaces/:workspace', async (req): Promise<Workspace.Deleted | void> => {
    const found = await loadWorkspace(deps, req, {
      owner: true,
      forbidden: 'Only an owner can delete the workspace',
    })
    const { confirm } = parse(deleteBody, req.body)
    if (confirm.trim() !== found.workspace.slug) {
      throw new ValidationError('Type the workspace’s address to confirm')
    }
    const { deletedAt } = await deleteWorkspace(deps.db, {
      workspaceId: found.workspace.id,
      userId: currentUser(req).id,
    })
    return { purgeAt: workspacePurgeAt(deletedAt).toISOString() }
  })

  app.get('/workspaces/:workspace/settings', async (req): Promise<Workspace.SettingsResponse> => {
    const found = await loadWorkspace(deps, req)
    return {
      canManage: found.canManage,
      settings: await getWorkspaceSettings(deps.db, found.workspace.id),
      teams: await listTeamFlakyOverrides(deps.db, found.workspace.id),
    }
  })

  app.patch('/workspaces/:workspace/settings', async (req) => {
    const found = await loadWorkspace(deps, req, { manage: true, forbidden: MANAGE })
    const patch = parse(body, req.body)
    return { settings: await updateWorkspaceSettings(deps.db, found.workspace.id, patch) }
  })
}
