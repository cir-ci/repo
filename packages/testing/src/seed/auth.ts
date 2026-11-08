import { type Database, schema } from '@circi/db'

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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A pending invitation to `orgId`, valid for an hour unless `expiresAt` says otherwise. */
export async function seedInvitation(
  db: Database,
  input: {
    orgId: string
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
      organizationId: input.orgId,
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

/** An email domain claimed by `orgId`; verified now unless `verified` is false. */
export async function seedOrgDomain(
  db: Database,
  input: { orgId: string; domain: string; verified?: boolean },
) {
  n += 1
  const [row] = await db
    .insert(schema.orgDomains)
    .values({
      orgId: input.orgId,
      domain: input.domain,
      verificationToken: `token-${n}`,
      ...(input.verified === false ? {} : { verifiedAt: new Date() }),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** A registered single sign-on provider of `orgId`, with `userId` as its registrant. */
export async function seedSsoProvider(
  db: Database,
  input: { orgId: string; userId: string; issuer: string; domain?: string; providerId?: string },
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
      organizationId: input.orgId,
      domain: input.domain ?? 'sso.example.com',
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
