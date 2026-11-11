import { randomBytes } from 'node:crypto'

import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { ConflictError, type Database, NotFoundError, type Project } from '@circi/db'
import {
  findWorkspaceOwnerId,
  getWorkspaceBySlug,
  getProjectBySlugs,
  getProjectContext,
} from '@circi/db/queries'
import { createProject, deleteProject, setProjectCiKey } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { eq } from 'drizzle-orm'

import type { Auth } from '#src/auth.ts'
import { CI_KEY_CONFIG, CI_KEY_PREFIX, MIN_PASSWORD_LENGTH } from '#src/constants.ts'

/**
 * Operations that span better-auth and CirCI's own data: accounts, workspaces, members, and
 * each project's CI key. Used by the admin CLI and the CI API. Writes to better-auth's tables
 * always go through its API, so its invariants (hashing, ids, hooks) hold.
 */

/**
 * Creates an account. Without a `password` it has no credential at all (better-auth creates it
 * without one): the person signs in with an emailed code or single sign-on.
 */
export async function createUser(
  auth: Auth,
  input: { email: string; name: string; password?: string; instanceAdmin?: boolean },
) {
  if (input.password !== undefined) assertPasswordLength(input.password)
  const { user } = await auth.api.createUser({
    body: {
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      ...(input.password === undefined ? {} : { password: input.password }),
      role: input.instanceAdmin ? 'admin' : 'user',
    },
  })
  // An operator vouches for the accounts they create. Left unverified, the first email-code
  // sign-in would count as proof of ownership and better-auth would delete the password of
  // such an "unproven" account.
  const context = await auth.$context
  await context.internalAdapter.updateUser(user.id, { emailVerified: true })
  return { ...user, emailVerified: true }
}

/**
 * Removes an account that was just made, when what was meant to follow it failed (first-run setup
 * makes an account and its workspace as one, so a failure leaves neither). Not for existing people:
 * their data goes through the workspace and account deletion flows.
 */
export async function deleteNewUser(auth: Auth, userId: string): Promise<void> {
  const context = await auth.$context
  await context.internalAdapter.deleteUser(userId)
}

/**
 * Makes an account an instance admin, or an ordinary user again. `headers` are the requesting
 * admin's: better-auth checks that they may change roles.
 */
export async function setInstanceAdmin(
  auth: Auth,
  input: { userId: string; instanceAdmin: boolean; headers: Headers },
): Promise<void> {
  await auth.api.setRole({
    body: { userId: input.userId, role: input.instanceAdmin ? 'admin' : 'user' },
    headers: input.headers,
  })
}

/**
 * Sets an account's email address as an instance admin, with no confirmation mail (the admin
 * vouches for it, so it counts as verified, like accounts made from the command line). `headers`
 * are the requesting admin's: better-auth checks that they may.
 */
export async function setUserEmail(
  auth: Auth,
  input: { userId: string; email: string; headers: Headers },
): Promise<void> {
  await auth.api.adminUpdateUser({
    body: { userId: input.userId, data: { email: input.email, emailVerified: true } },
    headers: input.headers,
  })
}

/**
 * Mails the address a one-time sign-in code and link: exactly what "Email me a code" on the
 * sign-in page does (same code, same mail, same expiry). Sent only when the instance has mail.
 */
export async function sendSignInCode(auth: Auth, email: string): Promise<void> {
  await auth.api.sendVerificationOTP({
    body: { email: email.trim().toLowerCase(), type: 'sign-in' },
  })
}

async function getUserIdByEmail(db: Database, email: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()))
  if (!row) throw new NotFoundError(`No user with email ${email}`)
  return row.id
}

/**
 * Replaces a user's password (signing them out everywhere is up to the caller). better-auth's
 * `setUserPassword` endpoint needs an admin session, which the CLI doesn't have, so this hashes
 * with better-auth's own hasher and updates the credential through its adapter.
 */
export async function setUserPassword(
  auth: Auth,
  db: Database,
  input: { email: string; password: string },
) {
  assertPasswordLength(input.password)
  const userId = await getUserIdByEmail(db, input.email)
  const context = await auth.$context
  const hash = await context.password.hash(input.password)
  const accounts = await context.internalAdapter.findAccounts(userId)
  if (accounts.some((a) => a.providerId === 'credential')) {
    await context.internalAdapter.updatePassword(userId, hash)
  } else {
    // A single-sign-on account has no password yet: this gives it one.
    await context.internalAdapter.linkAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hash,
    })
  }
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

/** Creates a workspace with `ownerEmail` as its owner. */
export async function createWorkspace(
  auth: Auth,
  db: Database,
  input: { name: string; slug?: string; ownerEmail: string },
) {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Workspace name is required')
  const slug = input.slug ?? slugify(name)
  assertValidSlug(slug, 'workspace slug')
  const userId = await getUserIdByEmail(db, input.ownerEmail)
  // better-auth would refuse too, but in its own words; a deleted workspace keeps its address
  // until it is purged, so that one gets its own message.
  const [existing] = await db
    .select({ id: schema.workspace.id, deleted: schema.workspaceDeletions.workspaceId })
    .from(schema.workspace)
    .leftJoin(
      schema.workspaceDeletions,
      eq(schema.workspaceDeletions.workspaceId, schema.workspace.id),
    )
    .where(eq(schema.workspace.slug, slug))
  if (existing) {
    throw new ConflictError(
      existing.deleted
        ? `A workspace at /${slug} was deleted and is still waiting to be purged. Choose another name, or restore it.`
        : `A workspace at /${slug} already exists. Choose another name.`,
    )
  }
  const workspace = await auth.api.createOrganization({ body: { name, slug, userId } })
  if (!workspace) throw new Error('better-auth returned no workspace')
  return workspace
}

/**
 * Renames a workspace and/or changes its slug (the address `<PUBLIC_URL>/<slug>/…`; old
 * addresses do not redirect). `logo` (the picture's key, or null to remove it) is optional. The slug follows the same rules as at creation (reserved words,
 * shape) and must be free. Written through better-auth's adapter, which owns the table.
 */
export async function updateWorkspace(
  auth: Auth,
  db: Database,
  input: { workspaceId: string; name?: string; slug?: string; logo?: string | null },
): Promise<{ name: string; slug: string }> {
  const [current] = await db
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, input.workspaceId))
  if (!current) throw new NotFoundError('Workspace not found')
  const name = input.name === undefined ? current.name : input.name.trim()
  if (!name) throw new ValidationError('Workspace name is required')
  const slug = input.slug === undefined ? current.slug : input.slug
  if (slug !== current.slug) {
    assertValidSlug(slug, 'workspace slug')
    const [taken] = await db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(eq(schema.workspace.slug, slug))
    if (taken) throw new ConflictError(`The address "${slug}" is already taken`)
  }
  const logoChanged = input.logo !== undefined && input.logo !== current.logo
  if (name !== current.name || slug !== current.slug || logoChanged) {
    const context = await auth.$context
    await context.adapter.update({
      model: 'organization',
      where: [{ field: 'id', value: input.workspaceId }],
      update: { name, slug, ...(logoChanged ? { logo: input.logo } : {}) },
    })
  }
  return { name, slug }
}

export async function addMember(
  auth: Auth,
  db: Database,
  input: { workspaceSlug: string; email: string; role: 'owner' | 'admin' | 'member' },
) {
  const workspace = await getWorkspaceBySlug(db, input.workspaceSlug)
  const userId = await getUserIdByEmail(db, input.email)
  return auth.api.addMember({ body: { userId, organizationId: workspace.id, role: input.role } })
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
  input: {
    workspaceSlug: string
    name: string
    slug?: string
    defaultBranch?: string
    color?: string
    icon?: string | null
    /** The person creating it: recorded as who issued the first token, and added to the project. */
    createdBy?: string
    /** More workspace members to add to the project (none by default). */
    memberIds?: string[]
    /** The same by email address (the admin CLI); the accounts must exist. */
    memberEmails?: string[]
  },
): Promise<IssuedToken> {
  const { createdBy, memberEmails, ...project } = input
  const fromEmails = await Promise.all((memberEmails ?? []).map((e) => getUserIdByEmail(db, e)))
  const memberIds = [...(project.memberIds ?? []), ...fromEmails]
  const created = await createProject(db, {
    ...project,
    ...(memberIds.length === 0 ? {} : { memberIds }),
    ...(createdBy === undefined ? {} : { createdBy }),
  })
  return issueToken(auth, db, input.workspaceSlug, created, createdBy)
}

/**
 * Replaces a project's CI token. The old one stops working immediately. The token is returned
 * once; only its hash is stored (better-auth hashes the key).
 */
export async function rotateProjectToken(
  auth: Auth,
  db: Database,
  input: { workspaceSlug: string; projectslug: string; rotatedBy?: string },
): Promise<IssuedToken> {
  const project = await getProjectBySlugs(db, input)
  return issueToken(auth, db, input.workspaceSlug, project, input.rotatedBy)
}

/** Deletes a project (see `deleteProject`) and revokes its CI key, so the token stops working at once. */
export async function deleteProjectWithToken(db: Database, projectId: string): Promise<void> {
  const keyId = await deleteProject(db, projectId)
  if (keyId) await db.delete(schema.apikey).where(eq(schema.apikey.id, keyId))
}

async function issueToken(
  auth: Auth,
  db: Database,
  workspaceSlug: string,
  project: Project,
  issuedBy?: string,
): Promise<IssuedToken> {
  const previousKeyId = project.ciKeyId
  // Workspace-owned keys are issued on behalf of a user who may manage them: an owner.
  const ownerId = await findWorkspaceOwnerId(db, project.workspaceId)
  if (!ownerId) {
    throw new NotFoundError(`Workspace "${workspaceSlug}" has no owner to issue CI tokens for`)
  }
  const key = await auth.api.createApiKey({
    body: {
      userId: ownerId,
      configId: CI_KEY_CONFIG,
      organizationId: project.workspaceId,
      name: `${workspaceSlug}/${project.slug}`.slice(0, 32),
      prefix: CI_KEY_PREFIX,
      metadata: { projectId: project.id },
    },
  })
  await setProjectCiKey(db, project.id, key.id, issuedBy ?? null)
  // The project now points at the new key; remove the old one so it can't be used either.
  if (previousKeyId) await db.delete(schema.apikey).where(eq(schema.apikey.id, previousKeyId))
  return { project: { ...project, ciKeyId: key.id }, token: key.key }
}

/**
 * Resolves a CI token to its project. Valid only if better-auth accepts the key, it's the
 * project's *current* key, and the key belongs to the project's workspace.
 */
export async function verifyProjectToken(
  auth: Auth,
  db: Database,
  token: string,
): Promise<getProjectContext.Context | undefined> {
  if (!token.startsWith(CI_KEY_PREFIX)) return undefined
  const result = await auth.api.verifyApiKey({ body: { key: token, configId: CI_KEY_CONFIG } })
  if (!result.valid || !result.key) return undefined
  const projectId = readProjectId(result.key.metadata)
  if (!projectId) return undefined
  const ctx = await getProjectContext(db, projectId)
  if (
    !ctx ||
    ctx.project.ciKeyId !== result.key.id ||
    ctx.project.workspaceId !== result.key.referenceId
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
