import type { BuildOrder } from '@circi/core'
import { and, asc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'

import { workspaceAccepts, type SessionMethod } from '#repositories/auth-settings.ts'
import { builds, member, teams, user, workspace } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'

import { buildAfterCursor, buildOrderBy, workspaceTie } from './builds-order.ts'
import { buildFilterConditions, hydrateBuildList, type listBuildsForTeam } from './builds.ts'

/**
 * The builds of every team of a workspace in one list (a saved view with no team), and the
 * suggestions behind the author and reviewer filter chips. Every team of a workspace is visible
 * to each of its members, so "teams the user can see" is "the workspace's teams, if they belong
 * to it (and their session method is accepted)".
 */

export namespace listBuildsForWorkspace {
  export interface Item extends listBuildsForTeam.Item {
    team: { slug: string; name: string }
  }

  export interface Result {
    workspace: { slug: string; name: string }
    /** In the order asked for (newest first by default). */
    builds: listBuildsForWorkspace.Item[]
  }
}

/** The workspace if the person belongs to it, else undefined. */
async function visibleWorkspace(
  db: Database,
  input: { userId: string; workspaceSlug: string; method?: SessionMethod | undefined },
) {
  const [found] = await db
    .select({ id: workspace.id, slug: workspace.slug, name: workspace.name })
    .from(workspace)
    .innerJoin(member, and(eq(member.workspaceId, workspace.id), eq(member.userId, input.userId)))
    .where(
      and(eq(workspace.slug, input.workspaceSlug), workspaceAccepts(workspace.id, input.method)),
    )
  return found
}

/**
 * A page of the workspace's builds in `order`, with the same filters as a team's list. Build
 * numbers belong to a team, so the page cursor is a build id: `before` returns the builds that
 * come after that one in the order; a cursor that names no build of the workspace is a
 * `NotFoundError`.
 */
export async function listBuildsForWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    method?: SessionMethod | undefined
    limit: number
    before?: string
    filters?: listBuildsForTeam.Filters
    /** Default newest first. */
    order?: BuildOrder
  },
): Promise<listBuildsForWorkspace.Result | undefined> {
  const ws = await visibleWorkspace(db, input)
  if (!ws) return undefined
  const order = input.order ?? 'newest'
  if (input.before) {
    const [row] = await db
      .select({ id: builds.id })
      .from(builds)
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(and(eq(builds.id, input.before), eq(teams.workspaceId, ws.id)))
    if (!row) throw new NotFoundError('Page not found')
  }
  const found = await db
    .select({
      build: builds,
      member: { name: user.name, image: user.image },
      team: { slug: teams.slug, name: teams.name },
    })
    .from(builds)
    .innerJoin(teams, eq(teams.id, builds.teamId))
    .leftJoin(user, eq(user.id, builds.authorUserId))
    .where(
      and(
        eq(teams.workspaceId, ws.id),
        // Compared in the database, on the cursor row itself: a round trip through a JS Date
        // would cut the timestamp to milliseconds and repeat or skip builds.
        input.before
          ? buildAfterCursor(order, workspaceTie, (c) => sql`${c.id} = ${input.before}`)
          : undefined,
        ...buildFilterConditions(input.filters ?? {}),
      ),
    )
    .orderBy(...buildOrderBy(order, workspaceTie))
    .limit(input.limit)
  const items = await hydrateBuildList(db, found)
  const teamOf = new Map(found.map((f) => [f.build.id, f.team]))
  return {
    workspace: { slug: ws.slug, name: ws.name },
    builds: items.map((b) =>
      Object.assign({}, b, { team: teamOf.get(b.id) ?? { slug: '', name: '' } }),
    ),
  }
}

export namespace listBuildFilterSuggestions {
  export type Field = 'author' | 'reviewer'

  /** `value` is what the filter takes; `label` is what a person recognises. */
  export interface Item {
    value: string
    label: string
    kind: 'member' | 'login'
  }
}

export const SUGGESTION_LIMIT = 8

/** Escapes `%`, `_` and `\` so the typed text matches literally inside `ilike`. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/**
 * People to offer while someone types an author or reviewer filter: the workspace's members by
 * name (the value is their user id, which both filters accept), and for authors also the git
 * logins of builds nobody was matched to. Nothing is offered for emails: a name is what the
 * dashboard already shows. Undefined when the workspace is not visible.
 */
export async function listBuildFilterSuggestions(
  db: Database,
  input: {
    userId: string
    workspaceSlug: string
    method?: SessionMethod | undefined
    field: listBuildFilterSuggestions.Field
    query: string
    limit?: number
  },
): Promise<listBuildFilterSuggestions.Item[] | undefined> {
  const ws = await visibleWorkspace(db, input)
  if (!ws) return undefined
  const limit = input.limit ?? SUGGESTION_LIMIT
  const q = input.query.trim()
  const members = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.workspaceId, ws.id), q ? ilike(user.name, contains(q)) : undefined))
    .orderBy(asc(user.name), asc(user.id))
    .limit(limit)
  const items: listBuildFilterSuggestions.Item[] = members.map((m) => ({
    value: m.id,
    label: m.name,
    kind: 'member',
  }))
  if (input.field === 'author' && items.length < limit) {
    const logins = await db
      .selectDistinct({ login: builds.authorLogin })
      .from(builds)
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(
        and(
          eq(teams.workspaceId, ws.id),
          isNull(builds.authorUserId),
          q ? ilike(builds.authorLogin, contains(q)) : undefined,
          isNotNull(builds.authorLogin),
        ),
      )
      .orderBy(asc(builds.authorLogin))
      .limit(limit - items.length)
    for (const l of logins) {
      if (l.login) items.push({ value: l.login, label: l.login, kind: 'login' })
    }
  }
  return items
}
