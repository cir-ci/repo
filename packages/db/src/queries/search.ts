import { aliasedTable, and, desc, eq, ilike, isNull, max, ne, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import {
  type BuildStatus,
  builds,
  member,
  notifications,
  reviewRequests,
  savedViews,
  user,
  workspace,
  teams,
  type ReviewStatus,
  screenshots,
  type TriageKind,
  type NotificationKind,
} from '#schema/index.ts'
import { containsPattern, prefixPattern, segmentPattern } from '#shared/like.ts'
import { workspaceAccepts, type SessionMethod } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

import { loadChanges } from './reviews.ts'
import {
  baselineApprovers,
  searchPeople,
  type searchExtras,
  shotKey,
  shotThumbnails,
} from './search-extras.ts'
import { listTriage } from './triage.ts'

/**
 * Search for the command menu: one query string against a workspace's builds, branches, teams,
 * screenshot names, baselines, triage items, the person's notifications and review requests and
 * their saved views, grouped and limited per group. Limited to workspaces the user belongs to and
 * to teams they can see. Within a group an exact match comes first, then a prefix, then a match at
 * the start of a `/` segment, then any other containing the text; ties go to the newest.
 * Pull request titles are not stored, so a pull request matches by number only.
 */

export const SEARCH_LIMIT = 5

/** The most rows one kind may return (a "Show all" in the command menu asks for more than the default). */
export const SEARCH_MAX_LIMIT = 50

/** The kinds of result, named as the keys of the answer; `kinds` limits a search to some of them. */
export const SEARCH_KINDS = [
  'builds',
  'branches',
  'teams',
  'snapshots',
  'baselines',
  'triage',
  'notifications',
  'reviews',
  'views',
  'people',
] as const

/** How many of a workspace's teams the triage group looks through (the queue is derived per team). */
const TRIAGE_TEAMS = 30

export namespace searchWorkspace {
  export type Kind = (typeof SEARCH_KINDS)[number]

  export interface Build {
    teamSlug: string
    teamName: string
    number: number
    name: string
    branch: string | null
    prNumber: number | null
    status: BuildStatus
    reviewStatus: ReviewStatus
    /** How many screenshots changed, were added or were removed. */
    changes: { changed: number; added: number; removed: number }
    /** The file (a thumbnail) of the build's largest change; null when nothing changed. */
    thumbnail: string | null
  }

  export interface Person extends searchExtras.Person {}

  export interface Branch {
    teamSlug: string
    teamName: string
    branch: string
    /** The newest build on it. */
    latestBuildNumber: number
  }

  export interface Team {
    slug: string
    name: string
  }

  export interface Snapshot {
    teamSlug: string
    teamName: string
    name: string
    /** The newest build that has a screenshot of this name. */
    latestBuildNumber: number
    thumbnail: string | null
  }

  export interface Baseline {
    teamSlug: string
    teamName: string
    name: string
    /** The newest default-branch build that is a baseline source for the name. */
    buildNumber: number
    thumbnail: string | null
    /** Who approved it; null for an automatic approval. */
    approvedBy: string | null
  }

  export interface Triage {
    teamSlug: string
    teamName: string
    kind: TriageKind
    key: string
    snapshotName: string | null
    buildNumber: number
    branch: string | null
    assignee: { name: string } | null
  }

  export interface Notification {
    id: string
    kind: NotificationKind
    tab: 'everything' | 'snoozed'
    read: boolean
    createdAt: Date
    actor: { name: string } | null
    build: { number: number; name: string } | null
    team: { slug: string; name: string } | null
    payload: { snippet?: string; reason?: string; cc?: boolean }
  }

  export interface Review {
    id: string
    tab: 'for-you' | 'created' | 'snoozed'
    teamSlug: string
    teamName: string
    build: { number: number; name: string; branch: string | null }
    reviewer: { name: string }
    requestedBy: { name: string } | null
    /** When it was asked. */
    createdAt: Date
  }

  export interface View {
    id: string
    name: string
    team: { slug: string; name: string } | null
  }

  export interface Results {
    query: string
    builds: searchWorkspace.Build[]
    branches: searchWorkspace.Branch[]
    teams: searchWorkspace.Team[]
    snapshots: searchWorkspace.Snapshot[]
    baselines: searchWorkspace.Baseline[]
    triage: searchWorkspace.Triage[]
    notifications: searchWorkspace.Notification[]
    reviews: searchWorkspace.Review[]
    views: searchWorkspace.View[]
    people: searchWorkspace.Person[]
    /** How many match in all, per kind (the lists above are cut at the limit). */
    totals: Record<searchWorkspace.Kind, number>
  }
}

/** A person's name by their id, as a scalar subquery (joining the user table more than once collapses Drizzle's result type). */
const nameOf = (id: AnyPgColumn) =>
  sql<string | null>`(select ${user.name} from ${user} where ${user.id} = ${id})`

/** 0 for text equal to `q`, 1 starting with it, 2 starting a `/` segment with it, 3 any other match. */
const rank = (column: AnyPgColumn | SQL, q: string) =>
  sql`case when lower(${column}) = lower(${q}) then 0 when ${column} ilike ${prefixPattern(q)} then 1 when ${column} ilike ${segmentPattern(q)} then 2 else 3 end`

/** The same ranking for text held in memory. */
function textRank(text: string, q: string): number {
  const t = text.toLowerCase()
  const needle = q.toLowerCase()
  if (t === needle) return 0
  if (t.startsWith(needle)) return 1
  if (t.includes(`/${needle}`)) return 2
  return t.includes(needle) ? 3 : 4
}

/** How many matched in all: every row of a query carries the count. */
const totalOf = (rows: readonly { total: number }[]) => rows[0]?.total ?? 0

/** The screenshots of the rows that have a build to look in. */
const shotsOf = (
  rows: readonly { teamId: string; name: string; buildNumber: number | null }[],
): searchExtras.Shot[] =>
  rows.flatMap((r) =>
    r.buildNumber === null ? [] : [{ teamId: r.teamId, name: r.name, buildNumber: r.buildNumber }],
  )

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export async function searchWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    query: string
    limit?: number
    /** Only this team's results (a slug). A team the person can't see has none. */
    team?: string
    /** Only these kinds; the others come back empty with a total of 0. All when left out. */
    kinds?: readonly searchWorkspace.Kind[]
    method?: SessionMethod
    now?: Date
  },
): Promise<searchWorkspace.Results | undefined> {
  const [found] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(eq(workspace.slug, input.workspaceSlug), workspaceAccepts(workspace.id, input.method)),
    )
  if (!found) return undefined

  const q = input.query.trim()
  const limit = Math.min(input.limit ?? SEARCH_LIMIT, SEARCH_MAX_LIMIT)
  const now = input.now ?? new Date()
  const empty: searchWorkspace.Results = {
    query: q,
    builds: [],
    branches: [],
    teams: [],
    snapshots: [],
    baselines: [],
    triage: [],
    notifications: [],
    reviews: [],
    views: [],
    people: [],
    totals: {
      builds: 0,
      branches: 0,
      teams: 0,
      snapshots: 0,
      baselines: 0,
      triage: 0,
      notifications: 0,
      reviews: 0,
      views: 0,
      people: 0,
    },
  }
  if (q === '') return empty
  const wanted = new Set<searchWorkspace.Kind>(input.kinds ?? SEARCH_KINDS)
  const only = <T>(kind: searchWorkspace.Kind, run: () => PromiseLike<T[]>): Promise<T[]> =>
    wanted.has(kind) ? Promise.resolve(run()) : Promise.resolve([])

  const like = containsPattern(q)
  // "#148" and "148" both mean build 148 (and pull request 148).
  const numeric = /^#?(\d{1,9})$/.exec(q)
  const n = numeric ? Number(numeric[1]) : undefined
  const sha = /^[0-9a-f]{4,40}$/i.test(q)
  const inWorkspace = and(
    eq(teams.workspaceId, found.id),
    teamVisibleTo(input.userId, teams),
    input.team === undefined ? undefined : eq(teams.slug, input.team),
  )
  /** The number of matches before the limit: every query carries it on each row. */
  const total = sql<number>`count(*) over()`.mapWith(Number)
  const numberOf = (number: AnyPgColumn, pr?: AnyPgColumn): SQL | undefined =>
    n === undefined ? undefined : pr ? or(eq(number, n), eq(pr, n)) : eq(number, n)
  const actor = aliasedTable(user, 'actor')
  const reviewerName = nameOf(reviewRequests.reviewerId)
  const requesterName = nameOf(reviewRequests.requestedById)

  const [
    buildRows,
    branchRows,
    teamRows,
    snapshotRows,
    baselineRows,
    notificationRows,
    reviewRows,
    viewRows,
    triage,
    peopleFound,
  ] = await Promise.all([
    only('builds', () =>
      db
        .select({
          total,
          id: builds.id,
          teamSlug: teams.slug,
          teamName: teams.name,
          number: builds.number,
          name: builds.name,
          branch: builds.branch,
          prNumber: builds.prNumber,
          status: builds.status,
          reviewStatus: builds.reviewStatus,
        })
        .from(builds)
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .where(
          and(
            inWorkspace,
            or(
              numberOf(builds.number, builds.prNumber),
              sha ? ilike(builds.commitSha, prefixPattern(q)) : undefined,
              // "default" is the name of nearly every build: it says nothing.
              and(ne(builds.name, 'default'), ilike(builds.name, like)),
              ilike(builds.authorLogin, like),
              sql`exists (select 1 from ${user} where ${user.id} = ${builds.authorUserId} and ${user.name} ilike ${like})`,
            ) ?? sql`false`,
          ),
        )
        .orderBy(
          sql`case when ${builds.number} = ${n ?? -1} then 0 when ${builds.prNumber} = ${n ?? -1} then 1 when ${builds.commitSha} ilike ${prefixPattern(q)} then 1 else ${rank(builds.name, q)} + 1 end`,
          desc(builds.createdAt),
          desc(builds.number),
        )
        .limit(limit),
    ),
    only('branches', () =>
      db
        .select({
          total,
          teamSlug: teams.slug,
          teamName: teams.name,
          branch: builds.branch,
          latestBuildNumber: max(builds.number),
          latest: max(builds.createdAt),
        })
        .from(builds)
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .where(and(inWorkspace, ilike(builds.branch, like)))
        .groupBy(teams.slug, teams.name, builds.branch)
        .orderBy(rank(builds.branch, q), desc(max(builds.createdAt)), teams.slug)
        .limit(limit),
    ),
    only('teams', () =>
      db
        .select({ total, slug: teams.slug, name: teams.name })
        .from(teams)
        .where(and(inWorkspace, or(ilike(teams.name, like), ilike(teams.slug, like))))
        .orderBy(sql`least(${rank(teams.name, q)}, ${rank(teams.slug, q)})`, teams.slug)
        .limit(limit),
    ),
    only('snapshots', () =>
      db
        .select({
          total,
          teamId: teams.id,
          teamSlug: teams.slug,
          teamName: teams.name,
          name: screenshots.name,
          latestBuildNumber: max(builds.number),
        })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .where(and(inWorkspace, ilike(screenshots.name, like)))
        .groupBy(teams.id, teams.slug, teams.name, screenshots.name)
        .orderBy(rank(screenshots.name, q), desc(max(builds.createdAt)), screenshots.name)
        .limit(limit),
    ),
    // Baselines: screenshots of finished default-branch builds that were approved or had no changes.
    only('baselines', () =>
      db
        .select({
          total,
          teamId: teams.id,
          teamSlug: teams.slug,
          teamName: teams.name,
          name: screenshots.name,
          buildNumber: max(builds.number),
        })
        .from(screenshots)
        .innerJoin(builds, eq(builds.id, screenshots.buildId))
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .where(
          and(
            inWorkspace,
            ilike(screenshots.name, like),
            eq(builds.branch, teams.defaultBranch),
            eq(builds.status, 'complete'),
            or(eq(builds.reviewStatus, 'approved'), eq(builds.conclusion, 'no_changes')),
          ),
        )
        .groupBy(teams.id, teams.slug, teams.name, screenshots.name)
        .orderBy(rank(screenshots.name, q), desc(max(builds.createdAt)), screenshots.name)
        .limit(limit),
    ),
    only('notifications', () =>
      db
        .select({
          total,
          id: notifications.id,
          kind: notifications.kind,
          readAt: notifications.readAt,
          snoozedUntil: notifications.snoozedUntil,
          createdAt: notifications.createdAt,
          payload: notifications.payload,
          actorName: actor.name,
          buildNumber: builds.number,
          buildName: builds.name,
          teamSlug: teams.slug,
          teamName: teams.name,
        })
        .from(notifications)
        .innerJoin(builds, eq(builds.id, notifications.buildId))
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .leftJoin(actor, eq(actor.id, notifications.actorId))
        .where(
          and(
            eq(notifications.userId, input.userId),
            isNull(notifications.deletedAt),
            inWorkspace,
            or(
              numberOf(builds.number),
              ilike(actor.name, like),
              ilike(teams.name, like),
              ilike(builds.branch, like),
              and(ne(builds.name, 'default'), ilike(builds.name, like)),
              sql`${notifications.payload}->>'snippet' ilike ${like}`,
              sql`${notifications.payload}->>'reason' ilike ${like}`,
              sql`replace(${notifications.kind}, '_', ' ') ilike ${like}`,
            ),
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit),
    ),
    only('reviews', () =>
      db
        .select({
          total,
          id: reviewRequests.id,
          reviewerId: reviewRequests.reviewerId,
          snoozeKind: reviewRequests.snoozeKind,
          snoozedUntil: reviewRequests.snoozedUntil,
          createdAt: reviewRequests.createdAt,
          teamSlug: teams.slug,
          teamName: teams.name,
          buildNumber: builds.number,
          buildName: builds.name,
          branch: builds.branch,
          reviewerName,
          requesterName,
        })
        .from(reviewRequests)
        .innerJoin(builds, eq(builds.id, reviewRequests.buildId))
        .innerJoin(teams, eq(teams.id, builds.teamId))
        .where(
          and(
            eq(reviewRequests.state, 'open'),
            or(
              eq(reviewRequests.reviewerId, input.userId),
              eq(reviewRequests.requestedById, input.userId),
            ),
            inWorkspace,
            or(
              numberOf(builds.number, builds.prNumber),
              ilike(builds.branch, like),
              and(ne(builds.name, 'default'), ilike(builds.name, like)),
              ilike(teams.name, like),
              sql`${reviewerName} ilike ${like}`,
              sql`${requesterName} ilike ${like}`,
            ),
          ),
        )
        .orderBy(desc(reviewRequests.createdAt), reviewRequests.id)
        .limit(limit),
    ),
    only('views', () =>
      db
        .select({
          total,
          id: savedViews.id,
          name: savedViews.name,
          teamSlug: teams.slug,
          teamName: teams.name,
        })
        .from(savedViews)
        .leftJoin(teams, eq(teams.id, savedViews.teamId))
        .where(
          and(
            eq(savedViews.userId, input.userId),
            eq(savedViews.workspaceId, found.id),
            ilike(savedViews.name, like),
            or(
              isNull(savedViews.teamId),
              and(
                teamVisibleTo(input.userId, teams),
                input.team === undefined ? undefined : eq(teams.slug, input.team),
              ),
            ),
          ),
        )
        .orderBy(rank(savedViews.name, q), savedViews.name)
        .limit(limit),
    ),
    searchTriage(db, {
      userId: input.userId,
      workspaceId: found.id,
      q,
      limit,
      now,
      kept: wanted.has('triage'),
      ...(input.team === undefined ? {} : { team: input.team }),
    }),
    wanted.has('people')
      ? searchPeople(db, {
          userId: input.userId,
          workspaceId: found.id,
          q,
          limit,
          team: input.team,
        })
      : Promise.resolve({ people: [], total: 0 }),
  ])

  // What the peek shows beyond the rows: the largest change of each build, the thumbnail of each
  // screenshot and baseline, and who approved the baselines.
  const { changes, largest } = await loadChanges(
    db,
    buildRows.map((b) => b.id),
  )
  const snapshotShots = shotsOf(
    snapshotRows.map((r) => ({ ...r, buildNumber: r.latestBuildNumber })),
  )
  const baselineShots = shotsOf(baselineRows)
  const thumbs = await shotThumbnails(db, [...snapshotShots, ...baselineShots])
  const approvers = await baselineApprovers(db, thumbs, baselineShots)

  const snoozed = (r: { snoozeKind: unknown; snoozedUntil: Date | null }) =>
    r.snoozeKind !== null && (r.snoozedUntil === null || r.snoozedUntil > now)

  return {
    query: q,
    builds: buildRows.map(({ total: _total, id, ...r }) => {
      const c = changes.get(id)
      const top = largest.get(id)?.[0]
      return {
        ...r,
        changes: { changed: c?.changed ?? 0, added: c?.added ?? 0, removed: c?.removed ?? 0 },
        thumbnail: top ? (top.thumbnail ?? top.sha256) : null,
      }
    }),
    branches: branchRows.flatMap(
      ({ latest: _latest, total: _total, branch, latestBuildNumber, ...rest }) =>
        branch === null || latestBuildNumber === null
          ? []
          : [{ ...rest, branch, latestBuildNumber }],
    ),
    teams: teamRows.map(({ total: _total, ...r }) => r),
    snapshots: snapshotRows.flatMap(({ total: _total, teamId, ...r }) =>
      r.latestBuildNumber === null
        ? []
        : [
            {
              ...r,
              latestBuildNumber: r.latestBuildNumber,
              thumbnail:
                thumbs.get(shotKey({ teamId, name: r.name, buildNumber: r.latestBuildNumber }))
                  ?.sha256 ?? null,
            },
          ],
    ),
    baselines: baselineRows.flatMap(({ buildNumber, total: _total, teamId, ...r }) => {
      if (buildNumber === null) return []
      const key = shotKey({ teamId, name: r.name, buildNumber })
      return [
        {
          ...r,
          buildNumber,
          thumbnail: thumbs.get(key)?.sha256 ?? null,
          approvedBy: approvers.get(key) ?? null,
        },
      ]
    }),
    triage: triage.items,
    people: peopleFound.people,
    notifications: notificationRows.map((r) => {
      const snippet = asText(r.payload['snippet'])
      const reason = asText(r.payload['reason'])
      return {
        id: r.id,
        kind: r.kind,
        tab: r.snoozedUntil !== null && r.snoozedUntil > now ? 'snoozed' : 'everything',
        read: r.readAt !== null,
        createdAt: r.createdAt,
        actor: r.actorName === null ? null : { name: r.actorName },
        build: { number: r.buildNumber, name: r.buildName },
        team: { slug: r.teamSlug, name: r.teamName },
        payload: {
          ...(snippet ? { snippet } : {}),
          ...(reason ? { reason } : {}),
          ...(r.payload['cc'] === true ? { cc: true } : {}),
        },
      }
    }),
    reviews: reviewRows.map((r) => ({
      id: r.id,
      tab: r.reviewerId === input.userId ? (snoozed(r) ? 'snoozed' : 'for-you') : 'created',
      teamSlug: r.teamSlug,
      teamName: r.teamName,
      build: { number: r.buildNumber, name: r.buildName, branch: r.branch },
      reviewer: { name: r.reviewerName ?? '' },
      requestedBy: r.requesterName === null ? null : { name: r.requesterName },
      createdAt: r.createdAt,
    })),
    views: viewRows.map((r) => ({
      id: r.id,
      name: r.name,
      team:
        r.teamSlug === null || r.teamName === null ? null : { slug: r.teamSlug, name: r.teamName },
    })),
    totals: {
      builds: totalOf(buildRows),
      branches: totalOf(branchRows),
      teams: totalOf(teamRows),
      snapshots: totalOf(snapshotRows),
      baselines: totalOf(baselineRows),
      triage: triage.total,
      notifications: totalOf(notificationRows),
      reviews: totalOf(reviewRows),
      views: totalOf(viewRows),
      people: peopleFound.total,
    },
  }
}

const KIND_WORDS: Record<TriageKind, string> = {
  flaky: 'flaky',
  no_baseline: 'no baseline',
  failed: 'failed build',
}

/**
 * Triage items are derived per team (nothing is stored until someone acts), so this looks
 * through the queues of up to `TRIAGE_TEAMS` visible teams and keeps the awake items whose
 * screenshot, kind, branch, team, commit or build number matches.
 */
async function searchTriage(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    q: string
    limit: number
    now: Date
    /** False: the kind wasn't asked for, so no queue is read. */
    kept: boolean
    team?: string
  },
): Promise<{ items: searchWorkspace.Triage[]; total: number }> {
  const { q } = input
  if (!input.kept || q.length < 2) return { items: [], total: 0 }
  const list = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(
      and(
        eq(teams.workspaceId, input.workspaceId),
        teamVisibleTo(input.userId, teams),
        input.team === undefined ? undefined : eq(teams.slug, input.team),
      ),
    )
    .orderBy(teams.slug)
    .limit(TRIAGE_TEAMS)
  const numeric = /^#?(\d{1,9})$/.exec(q)
  const n = numeric ? Number(numeric[1]) : undefined
  const needle = q.toLowerCase()
  const queues = await Promise.all(
    list.map(async (team) => ({
      team,
      queue: await listTriage(db, { teamId: team.id, now: input.now }),
    })),
  )
  const matches = queues.flatMap(({ team, queue }) =>
    queue.items
      .filter((i) => !i.snoozed)
      .flatMap((i) => {
        const texts = [i.snapshotName ?? '', KIND_WORDS[i.kind], i.build.branch ?? '', team.name]
        const best = Math.min(
          ...texts.map((t) => textRank(t, q)),
          n !== undefined && i.build.number === n ? 0 : 4,
        )
        if (best > 3 && !i.build.commitSha.toLowerCase().startsWith(needle)) return []
        return [{ best, item: i, team }]
      }),
  )
  const sorted = matches.toSorted(
    (a, b) => a.best - b.best || b.item.build.number - a.item.build.number,
  )
  const items = sorted.slice(0, input.limit).map(({ item, team }) => ({
    teamSlug: team.slug,
    teamName: team.name,
    kind: item.kind,
    key: item.key,
    snapshotName: item.snapshotName,
    buildNumber: item.build.number,
    branch: item.build.branch,
    assignee: item.assignee ? { name: item.assignee.name } : null,
  }))
  return { items, total: sorted.length }
}
