import { NotFoundError } from '@circi/core'
import { type Build, findTeamForMember, getBuildByNumber, getTeamMemberRole } from '@circi/db'
import { type Actor, assertAllowed, canReadTeam, canWriteTeam } from '@circi/services'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { Deps } from './deps.ts'
import { parse } from './validation.ts'

export const teamParams = z.object({ workspace: z.string(), team: z.string() })
export const buildParams = teamParams.extend({ number: z.string() })

export namespace loadTeam {
  export interface Options {
    /** Owners and admins only: other members get 403 (non-members still get 404). */
    manage?: boolean
    /** The 403 message for `manage`. */
    forbidden?: string
    /** The 404 message for a team the user can't see (and, in `loadBuild`, for a missing build). */
    notFound?: string
  }
  export interface Found {
    team: findTeamForMember.Visible
    user: ReturnType<typeof currentUser>
    /** Whether the user is an owner or admin of the team's workspace. */
    canManage: boolean
  }
}

/**
 * The team a dashboard request names, if the signed-in user belongs to its workspace; anyone
 * else gets "not found" (thrown as `NotFoundError`, answered with 404), as for a team that
 * doesn't exist. With `manage`, members who are not owners or admins get `ForbiddenError` (403).
 */
export async function loadTeam(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  options: loadTeam.Options = {},
): Promise<loadTeam.Found> {
  const p = parse(teamParams, req.params)
  const user = currentUser(req)
  const team = await findTeamForMember(deps.db, {
    workspaceSlug: p.workspace,
    teamSlug: p.team,
    userId: user.id,
    method: user.method,
  })
  const messages = {
    notFound: options.notFound ?? 'Team not found',
    forbidden: options.forbidden ?? 'Only owners and admins can change this',
  }
  if (!team) {
    const outsider: Actor = { userId: user.id, instanceAdmin: false, role: undefined }
    assertAllowed(canReadTeam(outsider), messages)
    throw new NotFoundError(messages.notFound)
  }
  const role = await getTeamMemberRole(deps.db, team.id, user.id)
  const actor: Actor = { userId: user.id, instanceAdmin: false, role }
  if (options.manage) assertAllowed(canWriteTeam(actor), messages)
  return { team, user, canManage: canWriteTeam(actor).allow }
}

export namespace loadBuild {
  export interface Found extends loadTeam.Found {
    build: Build
  }
}

/**
 * The team (see `loadTeam`) and its build named by `:number`; otherwise `NotFoundError` with
 * `options.notFound`, or 'Build not found' for a missing build.
 */
export async function loadBuild(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  options: loadTeam.Options = {},
): Promise<loadBuild.Found> {
  const found = await loadTeam(deps, req, options)
  const number = Number(parse(buildParams, req.params).number)
  const build = Number.isInteger(number)
    ? await getBuildByNumber(deps.db, found.team.id, number)
    : undefined
  if (!build) throw new NotFoundError(options.notFound ?? 'Build not found')
  return { ...found, build }
}
