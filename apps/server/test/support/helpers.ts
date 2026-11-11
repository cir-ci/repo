import {
  type Auth,
  type Mailer,
  addMember as addWorkspaceMember,
  createAuth,
  createWorkspace,
  createProjectWithToken,
  createUser,
} from '@circi/auth'
import type { Database } from '@circi/db'
import { listProjects } from '@circi/db/queries'
import { addTestProjectMember } from '@circi/db/testing'
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
  project: Awaited<ReturnType<typeof createProjectWithToken>>['project']
  /** The project's CI token. */
  token: string
}

/** A user who owns a new workspace with one project, created the way the admin CLI does. */
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
  const { project, token } = await createProjectWithToken(auth, db, {
    workspaceSlug,
    name: 'web',
    memberIds: [owner.id],
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  return { owner: { id: owner.id, email: owner.email, password }, workspaceSlug, project, token }
}

/**
 * Adds someone to a workspace the way the admin CLI does, and (as the upgrade did for existing
 * projects) puts them in every project the workspace has now; `projects: false` leaves them in none, as an
 * invitation does. Projects made later have to be joined on purpose.
 */
export async function addMember(
  auth: Auth,
  db: Database,
  input: Parameters<typeof addWorkspaceMember>[2] & { projects?: boolean },
) {
  const { projects = true, ...rest } = input
  const result = await addWorkspaceMember(auth, db, rest)
  if (projects) {
    const userId = result.userId
    for (const project of await listProjects(db, input.workspaceSlug)) {
      // oxlint-disable-next-line no-await-in-loop -- a test workspace has a few projects
      await addTestProjectMember(db, { projectId: project.id, userId })
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
