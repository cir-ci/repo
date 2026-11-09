import { type Database } from '@circi/db'
import * as schema from '@circi/db/schema'

import { nextCreatedAt } from '../created-at.ts'

let n = 0

/** A linked sign-in account (by default GitHub) of `userId`, as better-auth leaves it. */
export async function seedAccount(
  db: Database,
  input: { userId: string; accountId: string; providerId?: string },
) {
  n += 1
  const [row] = await db
    .insert(schema.account)
    .values({
      id: `account-${n}`,
      accountId: input.accountId,
      providerId: input.providerId ?? 'github',
      userId: input.userId,
      createdAt: nextCreatedAt(),
      updatedAt: nextCreatedAt(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A pending invitation to `workspaceId`, valid for an hour unless `expiresAt` says otherwise. */
export async function seedInvitation(
  db: Database,
  input: {
    workspaceId: string
    inviterId: string
    email: string
    role?: string
    status?: string
    expiresAt?: Date
  },
) {
  n += 1
  const [row] = await db
    .insert(schema.invitation)
    .values({
      id: `invitation-${n}`,
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role ?? 'member',
      status: input.status ?? 'pending',
      expiresAt: input.expiresAt ?? new Date(Date.now() + 3_600_000),
      inviterId: input.inviterId,
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** An email domain claimed by `workspaceId`; verified now unless `verified` is false. */
export async function seedWorkspaceDomain(
  db: Database,
  input: { workspaceId: string; domain: string; verified?: boolean },
) {
  n += 1
  const [row] = await db
    .insert(schema.workspaceDomains)
    .values({
      workspaceId: input.workspaceId,
      domain: input.domain,
      verificationToken: `token-${n}`,
      ...(input.verified === false ? {} : { verifiedAt: new Date() }),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A registered single sign-on provider of `workspaceId`, with `userId` as its registrant. */
export async function seedSsoProvider(
  db: Database,
  input: {
    workspaceId: string
    userId: string
    issuer: string
    domain?: string
    providerId?: string
  },
) {
  n += 1
  const providerId = input.providerId ?? `provider-${n}`
  const [row] = await db
    .insert(schema.ssoProvider)
    .values({
      id: providerId,
      issuer: input.issuer,
      userId: input.userId,
      providerId,
      workspaceId: input.workspaceId,
      domain: input.domain ?? 'sso.example.com',
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
