import type { TeamColor } from '@circi/core'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { member, teamMembers, teams, user } from '#schema/index.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

/** Who belongs to a team, as the Members section, the pickers and the lists show them. */

export const MEMBER_PREVIEW = 5

export namespace listTeamMembers {
  export interface Item {
    id: string
    name: string
    email: string
    image: string | null
    /** The person's role in the team's workspace (roles are workspace-wide). */
    role: 'owner' | 'admin' | 'member'
    addedAt: Date
  }
}

const asRole = (role: string): listTeamMembers.Item['role'] =>
  role === 'owner' || role === 'admin' ? role : 'member'

/** The team's members by name. Anyone who has left the workspace is not listed. */
export async function listTeamMembers(
  db: Database,
  teamId: string,
): Promise<listTeamMembers.Item[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      addedAt: teamMembers.addedAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .innerJoin(member, and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, user.id)))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(user.name), asc(user.id))
  return rows.map((r) => Object.assign({}, r, { role: asRole(r.role) }))
}

/** Whether the user belongs to the team. */
export async function isTeamMember(db: Database, teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
  return row !== undefined
}

export namespace getTeamMemberSummaries {
  export interface Summary {
    memberCount: number
    /** Up to five, by name. */
    memberPreview: { id: string; name: string; image: string | null }[]
    youAreMember: boolean
  }
}

/** For each team id: how many people belong, the first few, and whether `userId` is one. */
export async function getTeamMemberSummaries(
  db: Database,
  teamIds: readonly string[],
  userId: string,
): Promise<Map<string, getTeamMemberSummaries.Summary>> {
  const out = new Map<string, getTeamMemberSummaries.Summary>()
  if (teamIds.length === 0) return out
  const rows = await db
    .select({ teamId: teamMembers.teamId, id: user.id, name: user.name, image: user.image })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .innerJoin(member, and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, user.id)))
    .where(inArray(teamMembers.teamId, [...teamIds]))
    .orderBy(asc(user.name), asc(user.id))
  for (const teamId of teamIds) {
    out.set(teamId, { memberCount: 0, memberPreview: [], youAreMember: false })
  }
  for (const r of rows) {
    const s = out.get(r.teamId)
    if (!s) continue
    s.memberCount += 1
    if (s.memberPreview.length < MEMBER_PREVIEW) {
      s.memberPreview.push({ id: r.id, name: r.name, image: r.image })
    }
    if (r.id === userId) s.youAreMember = true
  }
  return out
}

export namespace listWorkspaceMemberTeams {
  export interface Team {
    slug: string
    name: string
    color: TeamColor
    icon: string | null
  }
}

/**
 * Which teams each person of a workspace belongs to, limited to the teams `viewerId` may see
 * (all of them for an owner or admin; their own for a member). People in no visible team are
 * left out.
 */
export async function listWorkspaceMemberTeams(
  db: Database,
  input: { workspaceId: string; viewerId: string },
): Promise<Record<string, listWorkspaceMemberTeams.Team[]>> {
  const rows = await db
    .select({
      userId: teamMembers.userId,
      slug: teams.slug,
      name: teams.name,
      color: teams.color,
      icon: teams.icon,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(
      member,
      and(eq(member.workspaceId, teams.workspaceId), eq(member.userId, teamMembers.userId)),
    )
    .where(and(eq(teams.workspaceId, input.workspaceId), teamVisibleTo(input.viewerId, teams)))
    .orderBy(asc(teams.name), asc(teams.slug))
  const out: Record<string, listWorkspaceMemberTeams.Team[]> = {}
  for (const r of rows) {
    const list = out[r.userId] ?? []
    out[r.userId] = list
    list.push({ slug: r.slug, name: r.name, color: r.color, icon: r.icon })
  }
  return out
}
