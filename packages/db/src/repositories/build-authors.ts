import { and, eq, sql } from 'drizzle-orm'

import { account, builds, member, projects, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Who authored a build: lookups of the members it could be, and the store for a PR's author. */

/**
 * The users of the project's organization whose linked sign-in account at `providerId` (GitHub's
 * `github`, …) has this provider-side id. Account ids are unique per provider, so more than one
 * row means something is off and the caller must not guess.
 */
export async function findMembersByAccount(
  db: Database,
  projectId: string,
  providerId: string,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: account.userId })
    .from(account)
    .innerJoin(projects, eq(projects.id, projectId))
    .innerJoin(
      member,
      and(eq(member.userId, account.userId), eq(member.organizationId, projects.orgId)),
    )
    .where(and(eq(account.providerId, providerId), eq(account.accountId, accountId)))
  return rows.map((r) => r.userId)
}

/** The project's organization members with this verified email (compared case-insensitively). */
export async function findMembersByVerifiedEmail(
  db: Database,
  projectId: string,
  email: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: user.id })
    .from(user)
    .innerJoin(projects, eq(projects.id, projectId))
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, projects.orgId)))
    .where(and(eq(user.emailVerified, true), sql`lower(${user.email}) = ${email.toLowerCase()}`))
  return rows.map((r) => r.userId)
}

/**
 * Sets the author on every build of a pull request. The email is dropped when the login changes,
 * since it belonged to the previous author. Returns how many builds changed.
 */
export async function setPullRequestAuthor(
  db: Database,
  input: setPullRequestAuthor.Input,
): Promise<number> {
  const rows = await db
    .update(builds)
    .set({
      authorEmail: sql`case when ${builds.authorLogin} is not distinct from ${input.login} then ${builds.authorEmail} else null end`,
      authorLogin: input.login,
      authorUserId: input.userId,
    })
    .where(and(eq(builds.projectId, input.projectId), eq(builds.prNumber, input.prNumber)))
    .returning({ id: builds.id })
  return rows.length
}
export namespace setPullRequestAuthor {
  export interface Input {
    projectId: string
    prNumber: number
    login: string
    userId: string | null
  }
}
