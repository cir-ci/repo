import { WORKSPACE_PICTURE_PREFIX } from '@circi/core'
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import {
  builds,
  files,
  teams,
  screenshotDiffs,
  screenshots,
  siteHostnames,
  staticSites,
  uploadClaims,
  workspace,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { isForeignKeyViolation } from '#src/errors.ts'

/**
 * Retention and garbage collection (PLAN §8). Old data goes in three separate steps, so a
 * mistake in one can't lose files that something still needs:
 *
 *  1. **Expire**: builds and site versions past their team's `retention_days` lose their
 *     rows that point at files (screenshots, diffs, site files). Builds stay, as `expired`.
 *  2. **Mark**: files nothing points at any more get `gc_marked_at`.
 *  3. **Collect**: files marked for longer than a grace period are re-checked, and only then
 *     deleted. Anything that started pointing at one in the meantime (a build that was told "we
 *     already have it", a re-upload) un-marks it instead.
 */

/** The values of one column from a raw query's result, whichever driver ran it. */
function column(result: unknown, name: string): string[] {
  const rows: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
  if (!Array.isArray(rows)) return []
  return rows.map((row: unknown) => String(Reflect.get(Object(row), name)))
}

/** A file is referenced if anything at all points at it (a workspace's picture is named by its `logo`). */
const isReferenced = (sha: typeof files.sha256) => sql`(
  exists (select 1 from ${screenshots} where ${screenshots.fileSha256} = ${sha} or ${screenshots.thumbnailSha256} = ${sha})
  or exists (select 1 from ${screenshotDiffs} where ${screenshotDiffs.diffFileSha256} = ${sha})
  or exists (select 1 from static_site_files where static_site_files.sha256 = ${sha})
  or exists (select 1 from ${uploadClaims} where ${uploadClaims.fileSha256} = ${sha})
  or exists (select 1 from ${workspace} where ${workspace.logo} = ${WORKSPACE_PICTURE_PREFIX}::text || ${sha})
)`

/**
 * Expires finished builds older than their team's retention. The newest build that can serve
 * as a baseline on the default branch, per build name, is never expired: later builds compare
 * against it. Returns how many builds were expired.
 */
export async function expireBuilds(db: Database, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx.execute(sql`
      with keep as (
        select distinct on (b.team_id, b.name) b.id
        from ${builds} b
        join ${teams} p on p.id = b.team_id
        where b.status = 'complete'
          and b.branch = p.default_branch
          and (b.review_status = 'approved' or (b.conclusion = 'no_changes' and b.review_status <> 'rejected'))
        order by b.team_id, b.name, b.created_at desc
      )
      update ${builds} b
      set status = 'expired'
      from ${teams} p
      where p.id = b.team_id
        and b.status in ('complete', 'error')
        and b.created_at < ${now}::timestamptz - (p.retention_days * interval '1 day')
        and b.id not in (select id from keep)
      returning b.id
    `)
    const ids = column(expired, 'id')
    if (ids.length === 0) return 0
    await tx.delete(screenshotDiffs).where(inArray(screenshotDiffs.buildId, ids))
    await tx.delete(screenshots).where(inArray(screenshots.buildId, ids))
    await tx.delete(uploadClaims).where(inArray(uploadClaims.buildId, ids))
    return ids.length
  })
}

/**
 * Expires hosted sites: a branch address nobody uploaded to for the team's retention period
 * goes away (the default branch's never does), then versions older than retention that no live
 * branch address serves are deleted with their files list and commit address.
 */
export async function expireSites(
  db: Database,
  now: Date,
): Promise<{ addresses: number; versions: number }> {
  return db.transaction(async (tx) => {
    const addresses = await tx.execute(sql`
      delete from ${siteHostnames} h
      using team_sites s, ${teams} p
      where h.team_site_id = s.id and p.id = s.team_id
        and h.link_kind = 'branch'
        and h.branch is distinct from p.default_branch
        and h.updated_at < ${now}::timestamptz - (p.retention_days * interval '1 day')
      returning h.label
    `)
    const versions = await tx.execute(sql`
      delete from ${staticSites} v
      using team_sites s, ${teams} p
      where s.id = v.team_site_id and p.id = s.team_id
        and v.created_at < ${now}::timestamptz - (p.retention_days * interval '1 day')
        and not exists (
          select 1 from ${siteHostnames} h where h.static_site_id = v.id and h.link_kind = 'branch'
        )
      returning v.id
    `)
    return { addresses: column(addresses, 'label').length, versions: column(versions, 'id').length }
  })
}

/** Marks files nothing points at, so the next collection can consider them. */
export async function markUnreferencedFiles(db: Database, now: Date): Promise<number> {
  const marked = await db
    .update(files)
    .set({ gcMarkedAt: now })
    .where(and(isNull(files.gcMarkedAt), sql`not ${isReferenced(files.sha256)}`))
    .returning({ sha: files.sha256 })
  return marked.length
}

/** Un-marks files that something has started pointing at since they were marked. */
export async function unmarkReferencedFiles(db: Database): Promise<number> {
  const unmarked = await db
    .update(files)
    .set({ gcMarkedAt: null })
    .where(and(isNotNull(files.gcMarkedAt), isReferenced(files.sha256)))
    .returning({ sha: files.sha256 })
  return unmarked.length
}

/**
 * Deletes files marked for longer than `graceMs`, one at a time. Each is locked and checked
 * again: if something points at it now it's un-marked and kept. The row goes first, and then
 * its storage object (a failure there leaves an orphan object, never a row without bytes).
 */
export async function collectMarkedFiles(
  db: Database,
  input: { now: Date; graceMs: number; deleteObject: (storageKey: string) => Promise<void> },
): Promise<{ deleted: number; kept: number }> {
  const cutoff = new Date(input.now.getTime() - input.graceMs)
  const candidates = await db
    .select({ sha256: files.sha256 })
    .from(files)
    .where(and(isNotNull(files.gcMarkedAt), lt(files.gcMarkedAt, cutoff)))
  let deleted = 0
  let kept = 0
  for (const { sha256 } of candidates) {
    // eslint-disable-next-line no-await-in-loop -- one locked check and delete at a time
    const key = await db.transaction(async (tx): Promise<string | undefined> => {
      const [row] = await tx.select().from(files).where(eq(files.sha256, sha256)).for('update')
      if (!row?.gcMarkedAt) return undefined
      const [still] = await tx
        .select({ referenced: sql<boolean>`${isReferenced(files.sha256)}` })
        .from(files)
        .where(eq(files.sha256, sha256))
      if (still?.referenced) {
        await tx.update(files).set({ gcMarkedAt: null }).where(eq(files.sha256, sha256))
        return undefined
      }
      try {
        await tx.delete(files).where(eq(files.sha256, sha256))
      } catch (err) {
        // A reference appeared between the check and the delete: the foreign key says no.
        if (isForeignKeyViolation(err)) return undefined
        throw err
      }
      return row.storageKey
    })
    if (key === undefined) {
      kept += 1
      continue
    }
    deleted += 1
    // eslint-disable-next-line no-await-in-loop
    await input.deleteObject(key).catch(() => {})
  }
  return { deleted, kept }
}

export namespace previewCollection {
  export interface Preview {
    /** Files a collection run would delete now: unreferenced and marked longer than the grace. */
    wouldDelete: { count: number; bytes: number; sampleKeys: string[] }
    /** Unreferenced files not marked yet (or marked too recently); a run marks them, deletes nothing. */
    wouldMark: number
  }
}

/**
 * What `collectMarkedFiles` would delete, without deleting or marking anything. Builds and
 * sites that retention would expire are not simulated: their files only become unreferenced
 * when expiry runs.
 */
export async function previewCollection(
  db: Database,
  input: { now: Date; graceMs: number; sample?: number },
): Promise<previewCollection.Preview> {
  const cutoff = new Date(input.now.getTime() - input.graceMs)
  const due = and(
    isNotNull(files.gcMarkedAt),
    lt(files.gcMarkedAt, cutoff),
    sql`not ${isReferenced(files.sha256)}`,
  )
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint::float8`,
    })
    .from(files)
    .where(due)
  const sample = await db
    .select({ key: files.storageKey })
    .from(files)
    .where(due)
    .orderBy(files.gcMarkedAt, files.sha256)
    .limit(input.sample ?? 10)
  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(
      and(
        sql`not ${isReferenced(files.sha256)}`,
        sql`(${files.gcMarkedAt} is null or ${files.gcMarkedAt} >= ${cutoff.toISOString()}::timestamptz)`,
      ),
    )
  return {
    wouldDelete: {
      count: totals?.count ?? 0,
      bytes: totals?.bytes ?? 0,
      sampleKeys: sample.map((r) => r.key),
    },
    wouldMark: pending?.count ?? 0,
  }
}
