import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import {
  builds,
  member,
  reviewRequests,
  reviews,
  screenshots,
  snapshotReviews,
  teamMembers,
  teams,
  user,
} from '#schema/index.ts'
import { containsPattern, prefixPattern } from '#shared/like.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

/**
 * What the command menu's peek adds to a search result: thumbnails and approvers of screenshots
 * and baselines, and the people kind. Each takes the rows the search already limited, so none of
 * these queries reads more than one page of results.
 */

export namespace searchExtras {
  export interface Shot {
    teamId: string
    buildNumber: number
    name: string
  }

  export interface Person {
    id: string
    name: string
    email: string
    image: string | null
    /** The teams they belong to that the person searching can see. */
    teams: { slug: string; name: string }[]
    /** Open review requests asked of them, in teams the person searching can see. */
    openReviews: number
  }
}

export const shotKey = (s: searchExtras.Shot) => `${s.teamId}:${s.buildNumber}:${s.name}`

/** The thumbnail file (the full image when there is no thumbnail) and build of each named screenshot. */
export async function shotThumbnails(
  db: Database,
  shots: readonly searchExtras.Shot[],
): Promise<Map<string, { sha256: string; buildId: string }>> {
  const out = new Map<string, { sha256: string; buildId: string }>()
  if (shots.length === 0) return out
  const rows = await db
    .select({
      teamId: builds.teamId,
      buildId: builds.id,
      buildNumber: builds.number,
      name: screenshots.name,
      thumbnail: screenshots.thumbnailSha256,
      sha256: screenshots.fileSha256,
    })
    .from(screenshots)
    .innerJoin(builds, eq(builds.id, screenshots.buildId))
    .where(
      or(
        ...shots.map((s) =>
          and(
            eq(builds.teamId, s.teamId),
            eq(builds.number, s.buildNumber),
            eq(screenshots.name, s.name),
          ),
        ),
      ),
    )
  for (const r of rows) {
    out.set(shotKey({ teamId: r.teamId, buildNumber: r.buildNumber, name: r.name }), {
      sha256: r.thumbnail ?? r.sha256,
      buildId: r.buildId,
    })
  }
  return out
}

/** Who approved each baseline: the screenshot's own approval, else the build's latest one (null when automatic). */
export async function baselineApprovers(
  db: Database,
  found: ReadonlyMap<string, { buildId: string }>,
  shots: readonly searchExtras.Shot[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const buildIds = [...new Set([...found.values()].map((f) => f.buildId))]
  if (buildIds.length === 0) return out
  const own = await db
    .select({
      buildId: snapshotReviews.buildId,
      name: snapshotReviews.snapshotName,
      userId: snapshotReviews.userId,
    })
    .from(snapshotReviews)
    .where(
      and(
        inArray(snapshotReviews.buildId, buildIds),
        eq(snapshotReviews.decision, 'approved'),
        isNull(snapshotReviews.supersededAt),
      ),
    )
  const whole = await db
    .select({ buildId: reviews.buildId, userId: reviews.userId })
    .from(reviews)
    .where(and(inArray(reviews.buildId, buildIds), eq(reviews.state, 'approved')))
    .orderBy(desc(reviews.createdAt))
  const ownBy = new Map(own.map((o) => [`${o.buildId}:${o.name}`, o.userId]))
  const wholeBy = new Map<string, string | null>()
  for (const w of whole) if (!wholeBy.has(w.buildId)) wholeBy.set(w.buildId, w.userId)
  const ids = new Set<string>()
  const picked = new Map<string, string | null>()
  for (const s of shots) {
    const f = found.get(shotKey(s))
    if (!f) continue
    const k = `${f.buildId}:${s.name}`
    const id = ownBy.has(k) ? (ownBy.get(k) ?? null) : (wholeBy.get(f.buildId) ?? null)
    picked.set(shotKey(s), id)
    if (id) ids.add(id)
  }
  const names = new Map<string, string>()
  if (ids.size > 0) {
    const people = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...ids]))
    for (const p of people) names.set(p.id, p.name)
  }
  for (const [key, id] of picked) out.set(key, id ? (names.get(id) ?? null) : null)
  return out
}

/** `inArray` of team IDs (UUIDs) with an empty list matches nothing: an ID no team has stands in for it. */
const NO_TEAM = '00000000-0000-0000-0000-000000000000'
const anyOf = (list: readonly string[]) => (list.length > 0 ? [...list] : [NO_TEAM])

/**
 * The workspace's people matching a name or an email, name and email prefixes first. A person is
 * listed when the searcher is them, is an owner or admin, or shares a team they can see; with a
 * team, only that team's members (and nobody when the team is hidden from the searcher). Their
 * teams and open review requests count only teams the searcher can see.
 */
export async function searchPeople(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    q: string
    limit: number
    /** A team's slug. */
    team?: string | undefined
  },
): Promise<{ people: searchExtras.Person[]; total: number }> {
  const none = { people: [], total: 0 }
  const visible = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(and(eq(teams.workspaceId, input.workspaceId), teamVisibleTo(input.userId, teams)))
  const visibleIds = visible.map((t) => t.id)
  const scoped = input.team === undefined ? undefined : visible.find((t) => t.slug === input.team)
  if (input.team !== undefined && !scoped) return none
  const [me] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.workspaceId, input.workspaceId), eq(member.userId, input.userId)))
  const inTeams = (teamIds: string[]) =>
    inArray(
      user.id,
      db
        .select({ id: teamMembers.userId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, anyOf(teamIds))),
    )
  const reach = scoped
    ? inTeams([scoped.id])
    : or(
        eq(user.id, input.userId),
        me?.role === 'owner' || me?.role === 'admin' ? sql`true` : undefined,
        inTeams(visibleIds),
      )
  const like = containsPattern(input.q)
  const rank = sql`least(case when lower(${user.name}) = lower(${input.q}) then 0 when ${user.name} ilike ${prefixPattern(input.q)} then 1 else 3 end, case when ${user.email} ilike ${prefixPattern(input.q)} then 1 else 3 end)`
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.workspaceId, input.workspaceId),
        or(sql`${user.name} ilike ${like}`, sql`${user.email} ilike ${like}`),
        reach,
      ),
    )
    .orderBy(rank, user.name, user.id)
    .limit(input.limit)
  if (rows.length === 0) return none
  const ids = rows.map((r) => r.id)
  const belongs = await db
    .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(inArray(teamMembers.userId, ids), inArray(teamMembers.teamId, anyOf(visibleIds))))
  const open =
    visibleIds.length === 0
      ? []
      : await db
          .select({ reviewerId: reviewRequests.reviewerId, n: sql<number>`count(*)::int` })
          .from(reviewRequests)
          .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
          .where(
            and(
              eq(reviewRequests.state, 'open'),
              inArray(reviewRequests.reviewerId, ids),
              inArray(builds.teamId, visibleIds),
            ),
          )
          .groupBy(reviewRequests.reviewerId)
  const openBy = new Map(open.map((o) => [o.reviewerId, o.n]))
  const byName = visible.toSorted((a, b) => a.name.localeCompare(b.name))
  return {
    total: rows[0]?.total ?? 0,
    people: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      image: r.image,
      teams: byName
        .filter((t) => belongs.some((b) => b.userId === r.id && b.teamId === t.id))
        .map(({ slug, name }) => ({ slug, name })),
      openReviews: openBy.get(r.id) ?? 0,
    })),
  }
}
