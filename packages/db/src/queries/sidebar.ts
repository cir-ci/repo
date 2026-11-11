import type { ProjectColor } from '@circi/core'
import { and, asc, count, eq, inArray } from 'drizzle-orm'

import { projects, projectsites } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { SessionMethod } from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

import { countUnreadNotifications } from './inbox.ts'
import { getProjectMemberSummaries } from './project-members.ts'
import { listReviewRequests } from './reviews.ts'
import { listPinnedProjectIds, listSavedViews, type SavedViewRow } from './saved-views.ts'
import { countAssignedTriage, countOpenTriage } from './triage.ts'

/** What the sidebar shows for one workspace, in the order it shows it. */

export namespace getSidebar {
  export interface Project {
    slug: string
    name: string
    color: ProjectColor
    icon: string | null
    pinned: boolean
    /** Triage items waiting (not snoozed, not dismissed). */
    triage: number
    /** People in the project. */
    memberCount: number
    /** The first few members, by name (up to five). */
    memberPreview: { id: string; name: string; image: string | null }[]
    /** Sites the project hosts. */
    siteCount: number
    /** Whether the person belongs to the project (an owner or admin may see one they don't). */
    youAreMember: boolean
  }

  export interface Result {
    /** The projects the person may see: pinned first (in pin order), then the rest A to Z. */
    projects: getSidebar.Project[]
    /** The person's saved views in this workspace, in their order. */
    views: SavedViewRow[]
    /** Unread, visible, awake notifications (across all of the person's workspaces). */
    inboxUnread: number
    /** Open, awake review requests asked of the person in this workspace. */
    reviews: number
    /** Awake triage items assigned to the person in this workspace. */
    triageAssigned: number
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
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      color: projects.color,
      icon: projects.icon,
    })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, input.workspace.id), projectVisibleTo(input.userId, projects)),
    )
    .orderBy(asc(projects.name), asc(projects.slug))
  const pinOrder = await listPinnedProjectIds(db, input.userId)
  const rank = new Map(pinOrder.map((id, i) => [id, i]))
  const ordered = [
    ...rows
      .filter((r) => rank.has(r.id))
      .toSorted((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    ...rows.filter((r) => !rank.has(r.id)),
  ]
  const summaries = await getProjectMemberSummaries(
    db,
    rows.map((r) => r.id),
    input.userId,
  )
  const siteRows =
    rows.length === 0
      ? []
      : await db
          .select({ projectId: projectsites.projectId, n: count() })
          .from(projectsites)
          .where(
            inArray(
              projectsites.projectId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(projectsites.projectId)
  const siteCounts = new Map(siteRows.map((r) => [r.projectId, r.n]))
  const [views, inboxUnread, requests, triage, triageAssigned] = await Promise.all([
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
    countAssignedTriage(db, {
      userId: input.userId,
      projectIds: rows.map((r) => r.id),
      now: input.now,
    }),
  ])
  return {
    projects: ordered.map((p) => ({
      slug: p.slug,
      name: p.name,
      color: p.color,
      icon: p.icon,
      pinned: rank.has(p.id),
      triage: triage.get(p.id) ?? 0,
      memberCount: summaries.get(p.id)?.memberCount ?? 0,
      memberPreview: summaries.get(p.id)?.memberPreview ?? [],
      siteCount: siteCounts.get(p.id) ?? 0,
      youAreMember: summaries.get(p.id)?.youAreMember ?? false,
    })),
    views,
    inboxUnread,
    reviews: requests.filter((r) => r.workspace.slug === input.workspace.slug).length,
    triageAssigned,
  }
}
