import type { TeamColor } from '@circi/core'
import { and, asc, eq } from 'drizzle-orm'

import { teams } from '#schema/index.ts'
import type { SessionMethod } from '#shared/session-method.ts'
import { teamVisibleTo } from '#shared/team-visibility.ts'
import type { Database } from '#src/client.ts'

import { countUnreadNotifications } from './inbox.ts'
import { listReviewRequests } from './reviews.ts'
import { listPinnedTeamIds, listSavedViews, type SavedViewRow } from './saved-views.ts'
import { getTeamMemberSummaries } from './team-members.ts'
import { countOpenTriage } from './triage.ts'

/** What the sidebar shows for one workspace, in the order it shows it. */

export namespace getSidebar {
  export interface Team {
    slug: string
    name: string
    color: TeamColor
    icon: string | null
    pinned: boolean
    /** Triage items waiting (not snoozed, not dismissed). */
    triage: number
    /** People in the team. */
    memberCount: number
    /** The first few members, by name (up to five). */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Whether the person belongs to the team (an owner or admin may see one they don't). */
    youAreMember: boolean
  }

  export interface Result {
    /** The teams the person may see: pinned first (in pin order), then the rest A to Z. */
    teams: getSidebar.Team[]
    /** The person's saved views in this workspace, in their order. */
    views: SavedViewRow[]
    /** Unread, visible, awake notifications (across all of the person's workspaces). */
    inboxUnread: number
    /** Open, awake review requests asked of the person in this workspace. */
    reviews: number
  }
}

export async function getSidebar(
  db: Database,
  input: {
    userId: string
    workspace: { id: string; slug: string }
    now: Date
    method?: SessionMethod
  },
): Promise<getSidebar.Result> {
  const rows = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      color: teams.color,
      icon: teams.icon,
    })
    .from(teams)
    .where(and(eq(teams.workspaceId, input.workspace.id), teamVisibleTo(input.userId, teams)))
    .orderBy(asc(teams.name), asc(teams.slug))
  const pinOrder = await listPinnedTeamIds(db, input.userId)
  const rank = new Map(pinOrder.map((id, i) => [id, i]))
  const ordered = [
    ...rows
      .filter((r) => rank.has(r.id))
      .toSorted((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    ...rows.filter((r) => !rank.has(r.id)),
  ]
  const summaries = await getTeamMemberSummaries(
    db,
    rows.map((r) => r.id),
    input.userId,
  )
  const [views, inboxUnread, requests, triage] = await Promise.all([
    listSavedViews(db, { userId: input.userId, workspaceId: input.workspace.id }),
    countUnreadNotifications(db, {
      userId: input.userId,
      now: input.now,
      ...(input.method === undefined ? {} : { method: input.method }),
    }),
    listReviewRequests(db, {
      userId: input.userId,
      tab: 'for-you',
      now: input.now,
      ...(input.method === undefined ? {} : { method: input.method }),
    }),
    countOpenTriage(db, { workspaceId: input.workspace.id, now: input.now }),
  ])
  return {
    teams: ordered.map((p) => ({
      slug: p.slug,
      name: p.name,
      color: p.color,
      icon: p.icon,
      pinned: rank.has(p.id),
      triage: triage.get(p.id) ?? 0,
      memberCount: summaries.get(p.id)?.memberCount ?? 0,
      memberPreview: summaries.get(p.id)?.memberPreview ?? [],
      youAreMember: summaries.get(p.id)?.youAreMember ?? false,
    })),
    views,
    inboxUnread,
    reviews: requests.filter((r) => r.workspace.slug === input.workspace.slug).length,
  }
}
