import { NotFoundError } from '@circi/core'
import { type Build } from '@circi/db'
import {
  findProjectForMember,
  getBuildByNumber,
  getProjectMemberRole,
  isProjectMember,
} from '@circi/db/queries'
import { type Actor, assertAllowed, canSeeProject, canWriteProject } from '@circi/services'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { Deps } from './deps.ts'
import { parse } from './validation.ts'

export const projectParams = z.object({ workspace: z.string(), project: z.string() })
export const buildParams = projectParams.extend({ number: z.string() })

export namespace loadProject {
  export interface Options {
    /** Owners and admins only: other members get 403 (non-members still get 404). */
    manage?: boolean
    /** The 403 message for `manage`. */
    forbidden?: string
    /** The 404 message for a project the user can't see (and, in `loadBuild`, for a missing build). */
    notFound?: string
  }
  export interface Found {
    project: findProjectForMember.Visible
    user: ReturnType<typeof currentUser>
    /** Whether the user is an owner or admin of the project's workspace. */
    canManage: boolean
    /** The user's role in the project's workspace. */
    role: string | undefined
    /** Whether the user belongs to the project (owners and admins may see it without). */
    isMember: boolean
  }
}

/**
 * The project a dashboard request names, if the signed-in user may see it (they belong to the project,
 * or are an owner or admin of its workspace); anyone else gets "not found" (thrown as
 * `NotFoundError`, answered with 404), as for a project that doesn't exist. With `manage`, members who are not owners or admins get `ForbiddenError` (403).
 */
export async function loadProject(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  options: loadProject.Options = {},
): Promise<loadProject.Found> {
  const p = parse(projectParams, req.params)
  const user = currentUser(req)
  const project = await findProjectForMember(deps.db, {
    workspaceSlug: p.workspace,
    projectSlug: p.project,
    userId: user.id,
    method: user.method,
  })
  const messages = {
    notFound: options.notFound ?? 'Project not found',
    forbidden: options.forbidden ?? 'Only owners and admins can change this',
  }
  if (!project) {
    const outsider: Actor = { userId: user.id, instanceAdmin: false, role: undefined }
    assertAllowed(canSeeProject(outsider), messages)
    throw new NotFoundError(messages.notFound)
  }
  const role = await getProjectMemberRole(deps.db, project.id, user.id)
  const isMember = await isProjectMember(deps.db, project.id, user.id)
  const actor: Actor = { userId: user.id, instanceAdmin: false, role, projectMember: isMember }
  assertAllowed(canSeeProject(actor), messages)
  if (options.manage) assertAllowed(canWriteProject(actor), messages)
  return { project, user, canManage: canWriteProject(actor).allow, role, isMember }
}

export namespace loadBuild {
  export interface Found extends loadProject.Found {
    build: Build
  }
}

/**
 * The project (see `loadProject`) and its build named by `:number`; otherwise `NotFoundError` with
 * `options.notFound`, or 'Build not found' for a missing build.
 */
export async function loadBuild(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  options: loadProject.Options = {},
): Promise<loadBuild.Found> {
  const found = await loadProject(deps, req, options)
  const number = Number(parse(buildParams, req.params).number)
  const build = Number.isInteger(number)
    ? await getBuildByNumber(deps.db, found.project.id, number)
    : undefined
  if (!build) throw new NotFoundError(options.notFound ?? 'Build not found')
  return { ...found, build }
}
