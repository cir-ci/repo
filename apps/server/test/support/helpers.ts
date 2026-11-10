import {
  type Auth,
  type Mailer,
  addMember as addWorkspaceMember,
  createAuth,
  createWorkspace,
  createTeamWithToken,
  createUser,
} from '@circi/auth'
import type { Database } from '@circi/db'
import { listTeams } from '@circi/db/queries'
import { addTestTeamMember } from '@circi/db/testing'
import type { FastifyInstance } from 'fastify'
import { expect } from 'vitest'

/** Public origin used by the server tests (better-auth builds its URLs and cookies from it). */
export const ORIGIN = 'https://ci.acme.io'

export function createTestAuth(
  db: Database,
  mailer?: Mailer,
  extra: Partial<createAuth.Options> = {},
): Auth {
  return createAuth({
    db,
    secret: 'test-secret-that-is-long-enough-1234',
    baseURL: ORIGIN,
    ...(mailer ? { mailer } : {}),
    ...extra,
  })
}

let n = 0

export interface Tenant {
  owner: { id: string; email: string; password: string }
  workspaceSlug: string
  team: Awaited<ReturnType<typeof createTeamWithToken>>['team']
  /** The team's CI token. */
  token: string
}

/** A user who owns a new workspace with one team, created the way the admin CLI does. */
export async function seedTenant(
  auth: Auth,
  db: Database,
  options: { defaultBranch?: string } = {},
): Promise<Tenant> {
  n += 1
  const password = `password-number-${n}-long`
  const owner = await createUser(auth, {
    email: `owner${n}@acme.test`,
    name: `Owner ${n}`,
    password,
  })
  const workspaceSlug = `workspace-${n}`
  await createWorkspace(auth, db, {
    name: `Workspace ${n}`,
    slug: workspaceSlug,
    ownerEmail: owner.email,
  })
  const { team, token } = await createTeamWithToken(auth, db, {
    workspaceSlug,
    name: 'web',
    memberIds: [owner.id],
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  return { owner: { id: owner.id, email: owner.email, password }, workspaceSlug, team, token }
}

/**
 * Adds someone to a workspace the way the admin CLI does, and (as the upgrade did for existing
 * teams) puts them in every team the workspace has now; `teams: false` leaves them in none, as an
 * invitation does. Teams made later have to be joined on purpose.
 */
export async function addMember(
  auth: Auth,
  db: Database,
  input: Parameters<typeof addWorkspaceMember>[2] & { teams?: boolean },
) {
  const { teams = true, ...rest } = input
  const result = await addWorkspaceMember(auth, db, rest)
  if (teams) {
    const userId = result.userId
    for (const team of await listTeams(db, input.workspaceSlug)) {
      // oxlint-disable-next-line no-await-in-loop -- a test workspace has a few teams
      await addTestTeamMember(db, { teamId: team.id, userId })
    }
  }
  return result
}

/** Signs in through the server's own `/api/auth` route; returns a `cookie` header value. */
export async function signIn(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: { email, password },
  })
  expect(res.statusCode).toBe(200)
  const cookies = [res.headers['set-cookie']]
    .flat()
    .filter((c): c is string => typeof c === 'string')
  expect(cookies.length).toBeGreaterThan(0)
  return cookies.map((c) => c.split(';')[0]).join('; ')
}
