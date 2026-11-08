import { and, eq, sql } from 'drizzle-orm'

import { account, builds, member, teams, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Who authored a build: lookups of the members it could be, and the store for a PR's author. */

/**
 * The users of the team's workspace whose linked sign-in account at `providerId` (GitHub's
 * `github`, …) has this provider-side id. Account ids are unique per provider, so more than one
 * row means something is off and the caller must not guess.
 */
export async function findMembersByAccount(
  db: Database,
  teamId: string,
  providerId: string,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: account.userId })
    .from(account)
    .innerJoin(teams, eq(teams.id, teamId))
    .innerJoin(
      member,
      and(eq(member.userId, account.userId), eq(member.workspaceId, teams.workspaceId)),
    )
    .where(and(eq(account.providerId, providerId), eq(account.accountId, accountId)))
  return rows.map((r) => r.userId)
}

/** The team's workspace members with this verified email (compared case-insensitively). */
export async function findMembersByVerifiedEmail(
  db: Database,
  teamId: string,
  email: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: user.id })
    .from(user)
    .innerJoin(teams, eq(teams.id, teamId))
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.workspaceId, teams.workspaceId)))
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
    .where(and(eq(builds.teamId, input.teamId), eq(builds.prNumber, input.prNumber)))
    .returning({ id: builds.id })
  return rows.length
}
export namespace setPullRequestAuthor {
  export interface Input {
    teamId: string
    prNumber: number
    login: string
    userId: string | null
  }
}
