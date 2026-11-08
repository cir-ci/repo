import { and, asc, desc, eq, max, ne, sql } from 'drizzle-orm'

import {
  builds,
  figmaLinks,
  integrationProjects,
  integrations,
  projects,
  screenshots,
  type FIGMA_LINK_SOURCES,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/**
 * Figma, per organisation and project: the organisation's connection (an `integrations` row of
 * kind `figma`), the file each project is designed in (`integration_projects`: `external_ref` is
 * the file key, `extra` holds `{ name, frames, frameCount }`), and the links from snapshot-name
 * patterns to frames (`figma_links`). Credentials arrive sealed and are never read here.
 */

/** What `integration_projects.extra` holds for a Figma file. */
export type FigmaFileExtra = {
  /** The file's name in Figma. */
  name: string
  /** Names of frames CirCI has seen, by node id, so links can show them without asking Figma. */
  frames?: Record<string, string>
  /** How many frames the file had when last read. */
  frameCount?: number
}

export namespace FigmaLink {
  export type Source = (typeof FIGMA_LINK_SOURCES)[number]

  export interface Row {
    id: string
    snapshotPattern: string
    fileKey: string
    nodeId: string
    source: Source
    createdAt: Date
  }

  export interface Input {
    integrationId: string
    projectId: string
    snapshotPattern: string
    fileKey: string
    nodeId: string
    source: Source
    createdBy?: string | null
  }
}

export namespace FigmaProject {
  export interface Row {
    projectId: string
    slug: string
    name: string
    fileKey: string | null
    fileName: string | null
    /** How many frames the file had when last read; null when unknown. */
    frameCount: number | null
    linked: number
  }

  export interface File {
    fileKey: string
    extra: FigmaFileExtra
  }
}

const asExtra = (extra: Record<string, unknown> | null | undefined): FigmaFileExtra => {
  const name = typeof extra?.name === 'string' ? extra.name : ''
  const frames =
    extra?.frames && typeof extra.frames === 'object'
      ? Object.fromEntries(
          Object.entries(extra.frames).filter(
            (e): e is [string, string] => typeof e[1] === 'string',
          ),
        )
      : undefined
  return {
    name,
    ...(frames ? { frames } : {}),
    ...(typeof extra?.frameCount === 'number' ? { frameCount: extra.frameCount } : {}),
  }
}

/** The organisation's Figma connection (one is used; the oldest). */
export async function findFigmaIntegration(db: Database, orgId: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.kind, 'figma')))
    .orderBy(asc(integrations.createdAt), asc(integrations.id))
  return row
}

/** Whether another organisation already connected this Figma account. */
export async function isFigmaAccountClaimedElsewhere(
  db: Database,
  externalId: string,
  orgId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.kind, 'figma'),
        eq(integrations.externalId, externalId),
        ne(integrations.orgId, orgId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Every project of the organisation with its Figma file (if any) and how many links it has. */
export async function listFigmaProjects(
  db: Database,
  orgId: string,
  integrationId: string,
): Promise<FigmaProject.Row[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      fileKey: integrationProjects.externalRef,
      extra: integrationProjects.extra,
      linked: sql<number>`(select count(*)::int from ${figmaLinks} where ${figmaLinks.projectId} = ${projects.id} and ${figmaLinks.integrationId} = ${integrationId})`,
    })
    .from(projects)
    .leftJoin(
      integrationProjects,
      and(
        eq(integrationProjects.projectId, projects.id),
        eq(integrationProjects.integrationId, integrationId),
      ),
    )
    .where(eq(projects.orgId, orgId))
    .orderBy(asc(projects.name), asc(projects.slug))
  return rows.map((r) => {
    const extra = r.fileKey ? asExtra(r.extra) : undefined
    return {
      projectId: r.projectId,
      slug: r.slug,
      name: r.name,
      fileKey: r.fileKey,
      fileName: extra?.name || null,
      frameCount: extra?.frameCount ?? null,
      linked: r.linked,
    }
  })
}

/** The Figma file a project is designed in. */
export async function getFigmaProjectFile(
  db: Database,
  integrationId: string,
  projectId: string,
): Promise<FigmaProject.File | undefined> {
  const [row] = await db
    .select()
    .from(integrationProjects)
    .where(
      and(
        eq(integrationProjects.integrationId, integrationId),
        eq(integrationProjects.projectId, projectId),
      ),
    )
  return row ? { fileKey: row.externalRef, extra: asExtra(row.extra) } : undefined
}

/** A project's links, newest last, with the frame names CirCI knows. */
export async function listFigmaLinks(
  db: Database,
  projectId: string,
): Promise<(FigmaLink.Row & { frameName: string | null })[]> {
  const rows = await db
    .select({
      id: figmaLinks.id,
      snapshotPattern: figmaLinks.snapshotPattern,
      fileKey: figmaLinks.fileKey,
      nodeId: figmaLinks.nodeId,
      source: figmaLinks.source,
      createdAt: figmaLinks.createdAt,
      extra: integrationProjects.extra,
    })
    .from(figmaLinks)
    .leftJoin(
      integrationProjects,
      and(
        eq(integrationProjects.integrationId, figmaLinks.integrationId),
        eq(integrationProjects.projectId, figmaLinks.projectId),
      ),
    )
    .where(eq(figmaLinks.projectId, projectId))
    .orderBy(asc(figmaLinks.createdAt), asc(figmaLinks.id))
  return rows.map((r) => ({
    id: r.id,
    snapshotPattern: r.snapshotPattern,
    fileKey: r.fileKey,
    nodeId: r.nodeId,
    source: r.source === 'auto' ? 'auto' : 'manual',
    createdAt: r.createdAt,
    frameName: asExtra(r.extra).frames?.[r.nodeId] ?? null,
  }))
}

/** Adds a link; ConflictError when the project already has one for that pattern. */
export async function createFigmaLink(
  db: Database,
  input: FigmaLink.Input,
): Promise<FigmaLink.Row> {
  try {
    const [row] = await db
      .insert(figmaLinks)
      .values({ ...input, createdBy: input.createdBy ?? null })
      .returning()
    if (!row) throw new Error('insert returned no row')
    return { ...row, source: row.source === 'auto' ? 'auto' : 'manual' }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`A link for “${input.snapshotPattern}” already exists`)
    }
    throw err
  }
}

/**
 * Adds automatic links, leaving any pattern the project already has alone (a manual link, or an
 * earlier automatic one). Returns how many were added.
 */
export async function insertAutoFigmaLinks(
  db: Database,
  links: Omit<FigmaLink.Input, 'source'>[],
): Promise<number> {
  if (links.length === 0) return 0
  const rows = await db
    .insert(figmaLinks)
    .values(links.map((l) => ({ ...l, source: 'auto', createdBy: l.createdBy ?? null })))
    .onConflictDoNothing({ target: [figmaLinks.projectId, figmaLinks.snapshotPattern] })
    .returning({ id: figmaLinks.id })
  return rows.length
}

/** Removes one of the project's links. False when it isn't the project's. */
export async function deleteFigmaLink(
  db: Database,
  projectId: string,
  linkId: string,
): Promise<boolean> {
  const rows = await db
    .delete(figmaLinks)
    .where(and(eq(figmaLinks.projectId, projectId), eq(figmaLinks.id, linkId)))
    .returning({ id: figmaLinks.id })
  return rows.length > 0
}

/** Removes the automatic links to any file but `keepFileKey` (none given: all of them). */
export async function deleteAutoFigmaLinks(
  db: Database,
  projectId: string,
  keepFileKey?: string,
): Promise<void> {
  await db
    .delete(figmaLinks)
    .where(
      and(
        eq(figmaLinks.projectId, projectId),
        eq(figmaLinks.source, 'auto'),
        ...(keepFileKey ? [ne(figmaLinks.fileKey, keepFileKey)] : []),
      ),
    )
}

/** Remembers frame names for the project's file (merged into what is known). */
export async function rememberFigmaFrames(
  db: Database,
  input: {
    integrationId: string
    projectId: string
    frames: Record<string, string>
    frameCount?: number
  },
): Promise<void> {
  const current = await getFigmaProjectFile(db, input.integrationId, input.projectId)
  if (!current) return
  const extra: FigmaFileExtra = {
    ...current.extra,
    frames: { ...current.extra.frames, ...input.frames },
    ...(input.frameCount === undefined ? {} : { frameCount: input.frameCount }),
  }
  await db
    .update(integrationProjects)
    .set({ extra })
    .where(
      and(
        eq(integrationProjects.integrationId, input.integrationId),
        eq(integrationProjects.projectId, input.projectId),
      ),
    )
}

/** The Figma file extra for `setIntegrationProject`. */
export const figmaFileExtra = (name: string, frameCount?: number): FigmaFileExtra => ({
  name,
  ...(frameCount === undefined ? {} : { frameCount }),
})

/** Distinct snapshot names the project's builds have uploaded, most recently seen first. */
export async function listProjectSnapshotNames(
  db: Database,
  projectId: string,
  limit = 2000,
): Promise<string[]> {
  const rows = await db
    .select({ name: screenshots.name, last: max(screenshots.createdAt) })
    .from(screenshots)
    .innerJoin(builds, eq(builds.id, screenshots.buildId))
    .where(eq(builds.projectId, projectId))
    .groupBy(screenshots.name)
    .orderBy(desc(max(screenshots.createdAt)), asc(screenshots.name))
    .limit(limit)
  return rows.map((r) => r.name)
}
