import { randomBytes } from 'node:crypto'

import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import {
  createTeam,
  type Database,
  findWorkspaceOwnerId,
  getWorkspaceBySlug,
  getTeamBySlugs,
  getTeamContext,
  NotFoundError,
  type Team,
  schema,
  setTeamCiKey,
} from '@circi/db'
import { eq } from 'drizzle-orm'

import type { Auth } from '#src/auth.ts'
import { CI_KEY_CONFIG, CI_KEY_PREFIX, MIN_PASSWORD_LENGTH } from '#src/constants.ts'

/**
 * Operations that span better-auth and CirCI's own data: accounts, workspaces, members, and
 * each team's CI key. Used by the admin CLI and the CI API. Writes to better-auth's tables
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
  // An operator vouches for the accounts they create. Left unverified, the first email-code
  // sign-in would count as proof of ownership and better-auth would delete the password of
  // such an "unproven" account.
  const context = await auth.$context
  await context.internalAdapter.updateUser(user.id, { emailVerified: true })
  return { ...user, emailVerified: true }
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
  const workspace = await auth.api.createOrganization({ body: { name, slug, userId } })
  if (!workspace) throw new Error('better-auth returned no workspace')
  return workspace
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
  team: Team
  /** The CI token, shown exactly once. better-auth stores only its hash. */
  token: string
}

/** Creates a team and its first CI token. */
export async function createTeamWithToken(
  auth: Auth,
  db: Database,
  input: { workspaceSlug: string; name: string; slug?: string; defaultBranch?: string },
): Promise<IssuedToken> {
  const team = await createTeam(db, input)
  return issueToken(auth, db, input.workspaceSlug, team)
}

/** Replaces a team's CI token. The old one stops working immediately. */
export async function rotateTeamToken(
  auth: Auth,
  db: Database,
  input: { workspaceSlug: string; teamSlug: string },
): Promise<IssuedToken> {
  const team = await getTeamBySlugs(db, input)
  return issueToken(auth, db, input.workspaceSlug, team)
}

async function issueToken(
  auth: Auth,
  db: Database,
  workspaceSlug: string,
  team: Team,
): Promise<IssuedToken> {
  const previousKeyId = team.ciKeyId
  // Workspace-owned keys are issued on behalf of a user who may manage them: an owner.
  const ownerId = await findWorkspaceOwnerId(db, team.workspaceId)
  if (!ownerId) {
    throw new NotFoundError(`Workspace "${workspaceSlug}" has no owner to issue CI tokens for`)
  }
  const key = await auth.api.createApiKey({
    body: {
      userId: ownerId,
      configId: CI_KEY_CONFIG,
      organizationId: team.workspaceId,
      name: `${workspaceSlug}/${team.slug}`.slice(0, 32),
      prefix: CI_KEY_PREFIX,
      metadata: { teamId: team.id },
    },
  })
  await setTeamCiKey(db, team.id, key.id)
  // The team now points at the new key; remove the old one so it can't be used either.
  if (previousKeyId) await db.delete(schema.apikey).where(eq(schema.apikey.id, previousKeyId))
  return { team: { ...team, ciKeyId: key.id }, token: key.key }
}

/**
 * Resolves a CI token to its team. Valid only if better-auth accepts the key, it's the
 * team's *current* key, and the key belongs to the team's workspace.
 */
export async function verifyTeamToken(
  auth: Auth,
  db: Database,
  token: string,
): Promise<getTeamContext.Context | undefined> {
  if (!token.startsWith(CI_KEY_PREFIX)) return undefined
  const result = await auth.api.verifyApiKey({ body: { key: token, configId: CI_KEY_CONFIG } })
  if (!result.valid || !result.key) return undefined
  const teamId = readTeamId(result.key.metadata)
  if (!teamId) return undefined
  const ctx = await getTeamContext(db, teamId)
  if (
    !ctx ||
    ctx.team.ciKeyId !== result.key.id ||
    ctx.team.workspaceId !== result.key.referenceId
  ) {
    return undefined
  }
  return ctx
}

function readTeamId(metadata: unknown): string | undefined {
  const value: unknown = typeof metadata === 'string' ? safeJson(metadata) : metadata
  if (typeof value !== 'object' || value === null) return undefined
  const teamId: unknown = Reflect.get(value, 'teamId')
  return typeof teamId === 'string' ? teamId : undefined
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
