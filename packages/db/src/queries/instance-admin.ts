import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  max,
  min,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import { union } from 'drizzle-orm/pg-core'

import { QUEUES } from '#queue/jobs.ts'
import {
  builds,
  files,
  jobs,
  member,
  screenshotDiffs,
  screenshots,
  session,
  teams,
  user,
  workspace,
  workspaceDeletions,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Read models for the instance admin's pages: accounts, workspaces, job queues. */

export namespace listAccounts {
  export interface Input {
    /** Matches part of the email or name. */
    search?: string
    /** From 1. */
    page: number
    pageSize: number
  }
  export interface Item {
    id: string
    email: string
    name: string
    instanceAdmin: boolean
    banned: boolean
    banReason: string | null
    banExpires: Date | null
    createdAt: Date
    lastSignInAt: Date | null
    workspaceCount: number
  }
  export interface Result {
    accounts: Item[]
    total: number
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

const isAdminRole = (role: string | null) => (role ?? '').split(',').includes('admin')

/** Accounts newest first, with their workspace count and when they last signed in. */
export async function listAccounts(
  db: Database,
  input: listAccounts.Input,
): Promise<listAccounts.Result> {
  const term = input.search?.trim()
  const where = term
    ? or(ilike(user.email, `%${escapeLike(term)}%`), ilike(user.name, `%${escapeLike(term)}%`))
    : undefined
  const [total] = await db.select({ n: count() }).from(user).where(where)
  const rows = await db
    .select()
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), asc(user.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize)
  const ids = rows.map((r) => r.id)
  const workspaces = new Map<string, number>()
  const signedIn = new Map<string, Date>()
  if (ids.length > 0) {
    const counts = await db
      .select({ userId: member.userId, n: count() })
      .from(member)
      .where(inArray(member.userId, ids))
      .groupBy(member.userId)
    for (const c of counts) workspaces.set(c.userId, c.n)
    const last = await db
      .select({ userId: session.userId, at: max(session.createdAt) })
      .from(session)
      .where(inArray(session.userId, ids))
      .groupBy(session.userId)
    for (const l of last) if (l.at) signedIn.set(l.userId, l.at)
  }
  return {
    total: total?.n ?? 0,
    accounts: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      instanceAdmin: isAdminRole(r.role),
      banned: r.banned === true,
      banReason: r.banReason,
      banExpires: r.banExpires,
      createdAt: r.createdAt,
      lastSignInAt: signedIn.get(r.id) ?? null,
      workspaceCount: workspaces.get(r.id) ?? 0,
    })),
  }
}

/** One account in the shape of a list row. */
export async function getAccount(db: Database, id: string): Promise<listAccounts.Item | undefined> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, id))
  if (!row) return undefined
  const { accounts } = await listAccounts(db, { search: row.email, page: 1, pageSize: 50 })
  return accounts.find((a) => a.id === id)
}

/** How many accounts have the admin role. */
export async function countInstanceAdmins(db: Database): Promise<number> {
  const rows = await db.select({ role: user.role }).from(user).where(isNotNull(user.role))
  return rows.filter((r) => isAdminRole(r.role)).length
}

export namespace listInstanceWorkspaces {
  export interface Item {
    id: string
    name: string
    slug: string
    memberCount: number
    teamCount: number
    storageBytes: number
    createdAt: Date
    /** When an owner deleted it (it is purged 30 days later); null while it is live. */
    deletedAt: Date | null
  }
}

/** Every workspace by name (deleted ones too, marked), with member and team counts and the bytes its builds refer to. */
export async function listInstanceWorkspaces(db: Database): Promise<listInstanceWorkspaces.Item[]> {
  const rows = await db.select().from(workspace).orderBy(asc(workspace.name), asc(workspace.slug))
  const deletions = new Map(
    (await db.select().from(workspaceDeletions)).map((r) => [r.workspaceId, r.deletedAt]),
  )
  const members = new Map(
    (
      await db
        .select({ id: member.workspaceId, n: count() })
        .from(member)
        .groupBy(member.workspaceId)
    ).map((r) => [r.id, r.n]),
  )
  const teamCounts = new Map(
    (
      await db.select({ id: teams.workspaceId, n: count() }).from(teams).groupBy(teams.workspaceId)
    ).map((r) => [r.id, r.n]),
  )
  const refs = union(
    db
      .select({ workspaceId: teams.workspaceId, sha: screenshots.fileSha256 })
      .from(screenshots)
      .innerJoin(builds, eq(builds.id, screenshots.buildId))
      .innerJoin(teams, eq(teams.id, builds.teamId)),
    db
      .select({ workspaceId: teams.workspaceId, sha: sql<string>`${screenshots.thumbnailSha256}` })
      .from(screenshots)
      .innerJoin(builds, eq(builds.id, screenshots.buildId))
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(isNotNull(screenshots.thumbnailSha256)),
    db
      .select({
        workspaceId: teams.workspaceId,
        sha: sql<string>`${screenshotDiffs.diffFileSha256}`,
      })
      .from(screenshotDiffs)
      .innerJoin(builds, eq(builds.id, screenshotDiffs.buildId))
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(isNotNull(screenshotDiffs.diffFileSha256)),
  ).as('refs')
  const bytes = new Map(
    (
      await db
        .select({ id: refs.workspaceId, bytes: sum(files.size) })
        .from(refs)
        .innerJoin(files, eq(files.sha256, refs.sha))
        .groupBy(refs.workspaceId)
    ).map((r) => [r.id, Number(r.bytes ?? 0)]),
  )
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    memberCount: members.get(w.id) ?? 0,
    teamCount: teamCounts.get(w.id) ?? 0,
    storageBytes: bytes.get(w.id) ?? 0,
    createdAt: w.createdAt,
    deletedAt: deletions.get(w.id) ?? null,
  }))
}

export namespace getQueueDepth {
  export interface Item {
    queue: string
    pending: number
    running: number
    failed: number
    oldestPendingAt: Date | null
  }
}

/** Jobs not yet done, per queue; `known` queues are listed even when empty. */
export async function getQueueDepth(
  db: Database,
  known: readonly string[] = Object.values(QUEUES),
): Promise<getQueueDepth.Item[]> {
  const rows = await db
    .select({
      queue: jobs.queue,
      status: jobs.status,
      n: count(),
      oldest: min(jobs.runAt),
    })
    .from(jobs)
    .where(and(inArray(jobs.status, ['pending', 'running', 'failed'])))
    .groupBy(jobs.queue, jobs.status)
  const byQueue = new Map<string, getQueueDepth.Item>()
  for (const q of known) {
    byQueue.set(q, { queue: q, pending: 0, running: 0, failed: 0, oldestPendingAt: null })
  }
  for (const r of rows) {
    const item = byQueue.get(r.queue) ?? {
      queue: r.queue,
      pending: 0,
      running: 0,
      failed: 0,
      oldestPendingAt: null,
    }
    if (r.status === 'pending') {
      item.pending = r.n
      item.oldestPendingAt = r.oldest
    } else if (r.status === 'running') item.running = r.n
    else item.failed = r.n
    byQueue.set(r.queue, item)
  }
  return [...byQueue.values()].toSorted((a, b) => a.queue.localeCompare(b.queue))
}
