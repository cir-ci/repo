import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'

import {
  files,
  workspace,
  projects,
  projectSites,
  siteHostnames,
  staticSiteFiles,
  staticSites,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** What serving and the dashboard look up: by label, file, branch and project. */

export namespace findSiteByLabel {
  /** What an address serves, with who owns it. */
  export interface Site {
    label: string
    linkKind: 'commit' | 'branch'
    versionId: string
    commitSha: string
    entryPath: string
    site: { id: string; name: string; kind: string; slug: string; spa: boolean }
    project: { id: string; slug: string; name: string }
    workspace: { id: string; slug: string; name: string }
  }
}

export async function findSiteByLabel(
  db: Database,
  label: string,
): Promise<findSiteByLabel.Site | undefined> {
  const [row] = await db
    .select({
      label: siteHostnames.label,
      linkKind: siteHostnames.linkKind,
      versionId: staticSites.id,
      commitSha: staticSites.commitSha,
      entryPath: staticSites.entryPath,
      site: projectSites,
      project: projects,
      workspace: workspace,
    })
    .from(siteHostnames)
    .innerJoin(staticSites, eq(staticSites.id, siteHostnames.staticSiteId))
    .innerJoin(projectSites, eq(projectSites.id, siteHostnames.projectsiteId))
    .innerJoin(projects, eq(projects.id, projectSites.projectId))
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .where(eq(siteHostnames.label, label))
  if (!row) return undefined
  return {
    label: row.label,
    linkKind: row.linkKind === 'branch' ? 'branch' : 'commit',
    versionId: row.versionId,
    commitSha: row.commitSha,
    entryPath: row.entryPath,
    site: {
      id: row.site.id,
      name: row.site.name,
      kind: row.site.kind,
      slug: row.site.slug,
      spa: row.site.spa,
    },
    project: { id: row.project.id, slug: row.project.slug, name: row.project.name },
    workspace: { id: row.workspace.id, slug: row.workspace.slug, name: row.workspace.name },
  }
}

/**
 * What a verified custom domain serves: the site's version on the project's default branch, the
 * same as that branch's address (`linkKind: 'branch'`). The site's address is the domain itself,
 * so `label` is the domain. Undefined when the domain isn't a verified one, or the default
 * branch has no upload yet: both are answered like an address that doesn't exist.
 */
export async function findSiteByCustomDomain(
  db: Database,
  domain: string,
): Promise<findSiteByLabel.Site | undefined> {
  const [row] = await db
    .select({
      versionId: staticSites.id,
      commitSha: staticSites.commitSha,
      entryPath: staticSites.entryPath,
      site: projectSites,
      project: projects,
      workspace: workspace,
    })
    .from(projectSites)
    .innerJoin(projects, eq(projects.id, projectSites.projectId))
    .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
    .innerJoin(
      siteHostnames,
      and(
        eq(siteHostnames.projectsiteId, projectSites.id),
        eq(siteHostnames.linkKind, 'branch'),
        eq(siteHostnames.branch, projects.defaultBranch),
      ),
    )
    .innerJoin(staticSites, eq(staticSites.id, siteHostnames.staticSiteId))
    .where(
      and(
        eq(projectSites.customDomain, domain),
        isNotNull(projectSites.customDomainVerifiedAt),
        isNotNull(projectSites.customDomain),
      ),
    )
  if (!row) return undefined
  return {
    label: domain,
    linkKind: 'branch',
    versionId: row.versionId,
    commitSha: row.commitSha,
    entryPath: row.entryPath,
    site: {
      id: row.site.id,
      name: row.site.name,
      kind: row.site.kind,
      slug: row.site.slug,
      spa: row.site.spa,
    },
    project: { id: row.project.id, slug: row.project.slug, name: row.project.name },
    workspace: { id: row.workspace.id, slug: row.workspace.slug, name: row.workspace.name },
  }
}

/**
 * Whether `domain` is a verified custom domain of a site (whether or not it has an upload yet):
 * the one question a certificate authority's "may I issue?" check needs answered.
 */
export async function isVerifiedCustomDomain(db: Database, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectSites.id })
    .from(projectSites)
    .where(
      and(
        eq(projectSites.customDomain, domain),
        isNotNull(projectSites.customDomain),
        isNotNull(projectSites.customDomainVerifiedAt),
      ),
    )
  return row !== undefined
}

/**
 * The site an address names: a custom domain (it has dots, which a label never does) or a
 * hostname label. Every sign-in step looks addresses up through this.
 */
export async function findSiteByAddress(
  db: Database,
  address: string,
): Promise<findSiteByLabel.Site | undefined> {
  return address.includes('.')
    ? findSiteByCustomDomain(db, address.toLowerCase())
    : findSiteByLabel(db, address)
}

export namespace sitesForCommit {
  export interface Row {
    name: string
    kind: string
    slug: string
    /** The commit address's label, when it has one. */
    commitLabel: string | undefined
  }
}

/**
 * The sites a project has uploaded for a commit, by site name. `commitSha` may be abbreviated (a
 * build's SHA can be short): it matches an upload whose SHA starts with it, or the other way
 * round, never fewer than 7 characters.
 */
export async function sitesForCommit(
  db: Database,
  projectId: string,
  commitSha: string,
): Promise<sitesForCommit.Row[]> {
  const sha = commitSha.toLowerCase()
  if (sha.length < 7) return []
  const rows = await db
    .select({
      name: projectSites.name,
      kind: projectSites.kind,
      slug: projectSites.slug,
      label: siteHostnames.label,
    })
    .from(staticSites)
    .innerJoin(projectSites, eq(projectSites.id, staticSites.projectsiteId))
    .leftJoin(
      siteHostnames,
      and(eq(siteHostnames.staticSiteId, staticSites.id), eq(siteHostnames.linkKind, 'commit')),
    )
    .where(
      and(
        eq(projectSites.projectId, projectId),
        sql`(starts_with(${staticSites.commitSha}, ${sha}) or starts_with(${sha}, ${staticSites.commitSha}))`,
      ),
    )
    .orderBy(projectSites.name)
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    slug: r.slug,
    commitLabel: r.label ?? undefined,
  }))
}

/** A project site's custom domain and whether it is verified; undefined when the project has no such site. */
export async function getSiteCustomDomain(
  db: Database,
  projectId: string,
  slug: string,
): Promise<{ domain: string | null; verifiedAt: Date | null } | undefined> {
  const [row] = await db
    .select({ domain: projectSites.customDomain, verifiedAt: projectSites.customDomainVerifiedAt })
    .from(projectSites)
    .where(and(eq(projectSites.projectId, projectId), eq(projectSites.slug, slug)))
  return row
}

export async function getSiteFile(
  db: Database,
  versionId: string,
  path: string,
): Promise<{ sha256: string; size: number; contentType: string; storageKey: string } | undefined> {
  const [row] = await db
    .select({
      sha256: staticSiteFiles.sha256,
      size: staticSiteFiles.size,
      contentType: staticSiteFiles.contentType,
      storageKey: files.storageKey,
    })
    .from(staticSiteFiles)
    .innerJoin(files, eq(files.sha256, staticSiteFiles.sha256))
    .where(and(eq(staticSiteFiles.staticSiteId, versionId), eq(staticSiteFiles.path, path)))
  return row
}

/** The commit address currently serving a branch address's version (for service-worker kinds). */
export async function commitLabelOfVersion(
  db: Database,
  versionId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ label: siteHostnames.label })
    .from(siteHostnames)
    .where(and(eq(siteHostnames.staticSiteId, versionId), eq(siteHostnames.linkKind, 'commit')))
  return row?.label
}

export namespace listProjectSites {
  export interface Listing {
    name: string
    kind: string
    slug: string
    customDomain: { domain: string; verifiedAt: Date | null } | null
    versions: {
      commitSha: string
      branch: string | null
      createdAt: Date
      totalBytes: number
      commitLabel: string | undefined
    }[]
    branches: { branch: string; label: string; commitSha: string; updatedAt: Date }[]
  }
}

/** Every site of a project with its newest versions and the branches that have an address. */
export async function listProjectSites(
  db: Database,
  projectId: string,
): Promise<listProjectSites.Listing[]> {
  const sites = await db.select().from(projectSites).where(eq(projectSites.projectId, projectId))
  const result: listProjectSites.Listing[] = []
  for (const site of sites) {
    // eslint-disable-next-line no-await-in-loop -- a project has a handful of sites
    const versions = await db
      .select()
      .from(staticSites)
      .where(eq(staticSites.projectsiteId, site.id))
      .orderBy(desc(staticSites.createdAt))
      .limit(30)
    // eslint-disable-next-line no-await-in-loop
    const hostnames = await db
      .select()
      .from(siteHostnames)
      .where(eq(siteHostnames.projectsiteId, site.id))
    const byVersion = new Map(
      hostnames.filter((h) => h.linkKind === 'commit').map((h) => [h.staticSiteId, h.label]),
    )
    const commitOf = new Map(versions.map((v) => [v.id, v.commitSha]))
    result.push({
      name: site.name,
      kind: site.kind,
      slug: site.slug,
      customDomain: site.customDomain
        ? { domain: site.customDomain, verifiedAt: site.customDomainVerifiedAt }
        : null,
      versions: versions.map((v) => ({
        commitSha: v.commitSha,
        branch: v.branch,
        createdAt: v.createdAt,
        totalBytes: v.totalBytes,
        commitLabel: byVersion.get(v.id),
      })),
      branches: hostnames
        .filter((h) => h.linkKind === 'branch' && h.branch)
        .map((h) => ({
          branch: h.branch ?? '',
          label: h.label,
          commitSha: commitOf.get(h.staticSiteId) ?? '',
          updatedAt: h.updatedAt,
        }))
        .toSorted((a, b) => +b.updatedAt - +a.updatedAt),
    })
  }
  return result
}

/** The commit a branch address serves now, for a CLI deciding whether to move it. */
export async function servedCommitForBranch(
  db: Database,
  projectId: string,
  name: string,
  branch: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ commitSha: staticSites.commitSha })
    .from(siteHostnames)
    .innerJoin(projectSites, eq(projectSites.id, siteHostnames.projectsiteId))
    .innerJoin(staticSites, eq(staticSites.id, siteHostnames.staticSiteId))
    .where(
      and(
        eq(projectSites.projectId, projectId),
        eq(projectSites.name, name),
        eq(siteHostnames.linkKind, 'branch'),
        eq(siteHostnames.branch, branch),
      ),
    )
  return row?.commitSha
}
