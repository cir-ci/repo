import {
  type Auth,
  type Mailer,
  createAuth,
  createOrganization,
  createProjectWithToken,
  createUser,
} from '@circi/auth'
import type { Database } from '@circi/db'
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
  orgSlug: string
  project: Awaited<ReturnType<typeof createProjectWithToken>>['project']
  /** The project's CI token. */
  token: string
}

/** A user who owns a new organization with one project, created the way the admin CLI does. */
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
  const orgSlug = `org-${n}`
  await createOrganization(auth, db, { name: `Org ${n}`, slug: orgSlug, ownerEmail: owner.email })
  const { project, token } = await createProjectWithToken(auth, db, {
    orgSlug,
    name: 'web',
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
  return { owner: { id: owner.id, email: owner.email, password }, orgSlug, project, token }
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
