import { randomBytes } from 'node:crypto'

import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import {
  createProject,
  type Database,
  findOrganizationOwnerId,
  getOrganizationBySlug,
  getProjectBySlugs,
  getProjectContext,
  NotFoundError,
  type Project,
  type ProjectContext,
  schema,
  setProjectCiKey,
} from '@circi/db'
import { eq } from 'drizzle-orm'

import { type Auth, CI_KEY_CONFIG, CI_KEY_PREFIX, MIN_PASSWORD_LENGTH } from './auth.ts'

/**
 * Operations that span better-auth and CirCI's own data: accounts, organizations, members, and
 * each project's CI key. Used by the admin CLI and the CI API. Writes to better-auth's tables
 * always go through its API, so its invariants (hashing, ids, hooks) hold.
 */

export async function createUser(
  auth: Auth,
  input: { email: string; name: string; password: string; instanceAdmin?: boolean },
) {
  assertPasswordLength(input.password)
  const { user } = await auth.api.createUser({
    body: {
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      password: input.password,
      role: input.instanceAdmin ? 'admin' : 'user',
    },
  })
  return user
}

async function getUserIdByEmail(db: Database, email: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()))
  if (!row) throw new NotFoundError(`No user with email ${email}`)
  return row.id
}

/** Replaces a user's password (and signs them out everywhere else is up to the caller). */
export async function setUserPassword(
  auth: Auth,
  db: Database,
  input: { email: string; password: string },
) {
  assertPasswordLength(input.password)
  const userId = await getUserIdByEmail(db, input.email)
  await auth.api.setUserPassword({ body: { userId, newPassword: input.password } })
}

/** A random password that meets the minimum, for accounts created from the command line. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}

/** Creates an organization with `ownerEmail` as its owner. */
export async function createOrganization(
  auth: Auth,
  db: Database,
  input: { name: string; slug?: string; ownerEmail: string },
) {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Organization name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'organization slug')
  const userId = await getUserIdByEmail(db, input.ownerEmail)
  const org = await auth.api.createOrganization({ body: { name, slug, userId } })
  if (!org) throw new Error('better-auth returned no organization')
  return org
}

export async function addMember(
  auth: Auth,
  db: Database,
  input: { orgSlug: string; email: string; role: 'owner' | 'admin' | 'member' },
) {
  const org = await getOrganizationBySlug(db, input.orgSlug)
  const userId = await getUserIdByEmail(db, input.email)
  return auth.api.addMember({ body: { userId, organizationId: org.id, role: input.role } })
}

export interface IssuedToken {
  project: Project
  /** The CI token, shown exactly once. better-auth stores only its hash. */
  token: string
}

/** Creates a project and its first CI token. */
export async function createProjectWithToken(
  auth: Auth,
  db: Database,
  input: { orgSlug: string; name: string; slug?: string; defaultBranch?: string },
): Promise<IssuedToken> {
  const project = await createProject(db, input)
  return issueToken(auth, db, input.orgSlug, project)
}

/** Replaces a project's CI token. The old one stops working immediately. */
export async function rotateProjectToken(
  auth: Auth,
  db: Database,
  input: { orgSlug: string; projectSlug: string },
): Promise<IssuedToken> {
  const project = await getProjectBySlugs(db, input)
  return issueToken(auth, db, input.orgSlug, project)
}

async function issueToken(
  auth: Auth,
  db: Database,
  orgSlug: string,
  project: Project,
): Promise<IssuedToken> {
  const previousKeyId = project.ciKeyId
  // Organization-owned keys are issued on behalf of a user who may manage them: an owner.
  const ownerId = await findOrganizationOwnerId(db, project.orgId)
  if (!ownerId) {
    throw new NotFoundError(`Organization "${orgSlug}" has no owner to issue CI tokens for`)
  }
  const key = await auth.api.createApiKey({
    body: {
      userId: ownerId,
      configId: CI_KEY_CONFIG,
      organizationId: project.orgId,
      name: `${orgSlug}/${project.slug}`.slice(0, 32),
      prefix: CI_KEY_PREFIX,
      metadata: { projectId: project.id },
    },
  })
  await setProjectCiKey(db, project.id, key.id)
  // The project now points at the new key; remove the old one so it can't be used either.
  if (previousKeyId) await db.delete(schema.apikey).where(eq(schema.apikey.id, previousKeyId))
  return { project: { ...project, ciKeyId: key.id }, token: key.key }
}

/**
 * Resolves a CI token to its project. Valid only if better-auth accepts the key, it's the
 * project's *current* key, and the key belongs to the project's organization.
 */
export async function verifyProjectToken(
  auth: Auth,
  db: Database,
  token: string,
): Promise<ProjectContext | undefined> {
  if (!token.startsWith(CI_KEY_PREFIX)) return undefined
  const result = await auth.api.verifyApiKey({ body: { key: token, configId: CI_KEY_CONFIG } })
  if (!result.valid || !result.key) return undefined
  const projectId = readProjectId(result.key.metadata)
  if (!projectId) return undefined
  const ctx = await getProjectContext(db, projectId)
  if (
    !ctx ||
    ctx.project.ciKeyId !== result.key.id ||
    ctx.project.orgId !== result.key.referenceId
  ) {
    return undefined
  }
  return ctx
}

function readProjectId(metadata: unknown): string | undefined {
  const value: unknown = typeof metadata === 'string' ? safeJson(metadata) : metadata
  if (typeof value !== 'object' || value === null) return undefined
  const projectId: unknown = Reflect.get(value, 'projectId')
  return typeof projectId === 'string' ? projectId : undefined
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
