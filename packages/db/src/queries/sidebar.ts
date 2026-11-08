import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import type { SessionMethod } from '../repositories/auth-settings.ts'
import { listPinnedProjectIds, listSavedViews, type SavedViewRow } from '../repositories/views.ts'
import { projects } from '../schema/index.ts'
import { countUnreadNotifications } from './inbox.ts'
import { listReviewRequests } from './reviews.ts'
import { countOpenTriage } from './triage.ts'

/** What the sidebar shows for one organization, in the order it shows it. */

export interface SidebarProject {
  slug: string
  name: string
  pinned: boolean
  /** Triage items waiting (not snoozed, not dismissed). */
  triage: number
}

export interface Sidebar {
  /** Pinned projects first (in pin order), then the rest A to Z. */
  projects: SidebarProject[]
  /** The person's saved views in this organization, in their order. */
  views: SavedViewRow[]
  /** Unread, visible, awake notifications (across all of the person's organizations). */
  inboxUnread: number
  /** Open, awake review requests asked of the person in this organization. */
  reviews: number
}

export async function getSidebar(
  db: Database,
  input: { userId: string; org: { id: string; slug: string }; now: Date; method?: SessionMethod },
): Promise<Sidebar> {
  const rows = await db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, input.org.id)))
    .orderBy(asc(projects.name), asc(projects.slug))
  const pinOrder = await listPinnedProjectIds(db, input.userId)
  const rank = new Map(pinOrder.map((id, i) => [id, i]))
  const ordered = [
    ...rows
      .filter((r) => rank.has(r.id))
      .toSorted((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    ...rows.filter((r) => !rank.has(r.id)),
  ]
  const [views, inboxUnread, requests, triage] = await Promise.all([
    listSavedViews(db, { userId: input.userId, orgId: input.org.id }),
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
    Promise.all(ordered.map((p) => countOpenTriage(db, { projectId: p.id, now: input.now }))),
  ])
  return {
    projects: ordered.map((p, i) => ({
      slug: p.slug,
      name: p.name,
      pinned: rank.has(p.id),
      triage: triage[i] ?? 0,
    })),
    views,
    inboxUnread,
    reviews: requests.filter((r) => r.org.slug === input.org.slug).length,
  }
}
