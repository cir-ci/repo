import type { ProjectColor } from '@circi/core'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

import { files, projects } from '#schema/index.ts'
import { projectVisibleTo } from '#shared/project-visibility.ts'
import type { Database } from '#src/client.ts'

import { getWorkspaceSettings } from './workspace-settings.ts'

/** What is stored, for the whole instance (`circi admin storage usage`) and for one workspace. */

export namespace storageUsage {
  export interface Result {
    files: { kind: string; count: number; bytes: number }[]
    totalBytes: number
    markedForDeletion: { count: number; bytes: number }
  }
}

/** What's stored: by kind of file, and how much is waiting to be collected. */
export async function storageUsage(db: Database): Promise<storageUsage.Result> {
  const rows = await db
    .select({
      kind: files.kind,
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint::float8`,
    })
    .from(files)
    .where(eq(files.status, 'verified'))
    .groupBy(files.kind)
  const [marked] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint::float8`,
    })
    .from(files)
    .where(isNotNull(files.gcMarkedAt))
  return {
    files: rows.map((r) => ({ kind: r.kind, count: r.count, bytes: r.bytes })),
    totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
    markedForDeletion: { count: marked?.count ?? 0, bytes: marked?.bytes ?? 0 },
  }
}

export namespace getWorkspaceStorage {
  /** `site` is a hosted site's files; the others are what a build's screenshots point at. */
  export type Kind = 'screenshot' | 'diff' | 'thumbnail' | 'site'

  export interface KindUsage {
    kind: Kind
    /** Distinct files of this kind that the workspace's builds or sites refer to. */
    files: number
    bytes: number
    /** Hosted site versions (only for `site`). */
    versions?: number
  }

  export interface ProjectUsage {
    slug: string
    name: string
    color: ProjectColor
    icon: string | null
    retentionDays: number
    files: number
    bytes: number
  }

  export interface Result {
    /** Distinct files across the workspace: identical files are stored once, so the per-kind and per-project numbers add up to more. */
    totalBytes: number
    totalFiles: number
    kinds: KindUsage[]
    projects: ProjectUsage[]
    /** The retention a new project starts with. */
    defaultRetentionDays: number
  }
}

const KIND_ORDER: getWorkspaceStorage.Kind[] = ['screenshot', 'diff', 'thumbnail', 'site']

/** The result rows of a raw query, whichever driver ran it. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'rows') : undefined
  if (!Array.isArray(rows)) return []
  return rows.map((row: unknown) => Object(row))
}

const num = (value: unknown) => Number(value ?? 0)

/**
 * What a workspace's builds and hosted sites refer to, by kind and by project. A file shared by
 * several builds counts once per kind (and once per project); the total counts it once.
 */
export async function getWorkspaceStorage(
  db: Database,
  workspaceId: string,
  /** Lists only the projects this person may see (the totals still cover the whole workspace). */
  viewerId?: string,
): Promise<getWorkspaceStorage.Result> {
  // Every (project, file) pair the workspace refers to, with the file's size.
  const refs = sql`(
    select b.project_id, s.file_sha256 as sha, 'screenshot' as kind, f.size
      from builds b
      join projects t on t.id = b.project_id and t.workspace_id = ${workspaceId}
      join screenshots s on s.build_id = b.id
      join files f on f.sha256 = s.file_sha256
    union
    select b.project_id, s.thumbnail_sha256, 'thumbnail', f.size
      from builds b
      join projects t on t.id = b.project_id and t.workspace_id = ${workspaceId}
      join screenshots s on s.build_id = b.id
      join files f on f.sha256 = s.thumbnail_sha256
    union
    select b.project_id, d.diff_file_sha256, 'diff', f.size
      from builds b
      join projects t on t.id = b.project_id and t.workspace_id = ${workspaceId}
      join screenshot_diffs d on d.build_id = b.id
      join files f on f.sha256 = d.diff_file_sha256
    union
    select ts.project_id, sf.sha256, 'site', sf.size
      from project_sites ts
      join projects t on t.id = ts.project_id and t.workspace_id = ${workspaceId}
      join static_sites v on v.project_site_id = ts.id
      join static_site_files sf on sf.static_site_id = v.id
  ) refs`
  const byKind = rowsOf(
    await db.execute(sql`
      select kind, count(*)::int as files, coalesce(sum(size), 0)::float8 as bytes
      from (select distinct kind, sha, size from ${refs}) k
      group by kind`),
  )
  const byProject = rowsOf(
    await db.execute(sql`
      select project_id, count(*)::int as files, coalesce(sum(size), 0)::float8 as bytes
      from (select distinct project_id, sha, size from ${refs}) k
      group by project_id`),
  )
  const [total] = rowsOf(
    await db.execute(sql`
      select count(*)::int as files, coalesce(sum(size), 0)::float8 as bytes
      from (select distinct sha, size from ${refs}) k`),
  )
  const [versions] = rowsOf(
    await db.execute(sql`
      select count(*)::int as n
      from static_sites v
      join project_sites ts on ts.id = v.project_site_id
      join projects t on t.id = ts.project_id and t.workspace_id = ${workspaceId}`),
  )
  const projectRows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      color: projects.color,
      icon: projects.icon,
      retentionDays: projects.retentionDays,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        viewerId === undefined ? undefined : projectVisibleTo(viewerId, projects),
      ),
    )
  const projectUsage = new Map(byProject.map((r) => [String(r['project_id']), r]))
  const kindUsage = new Map(byKind.map((r) => [String(r['kind']), r]))
  return {
    totalBytes: num(total?.['bytes']),
    totalFiles: num(total?.['files']),
    kinds: KIND_ORDER.map((kind) => {
      const row = kindUsage.get(kind)
      const usage: getWorkspaceStorage.KindUsage = {
        kind,
        files: num(row?.['files']),
        bytes: num(row?.['bytes']),
      }
      if (kind === 'site') usage.versions = num(versions?.['n'])
      return usage
    }),
    projects: projectRows
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        color: t.color,
        icon: t.icon,
        retentionDays: t.retentionDays,
        files: num(projectUsage.get(t.id)?.['files']),
        bytes: num(projectUsage.get(t.id)?.['bytes']),
      }))
      .toSorted((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
    defaultRetentionDays: (await getWorkspaceSettings(db, workspaceId)).retentionDays,
  }
}
