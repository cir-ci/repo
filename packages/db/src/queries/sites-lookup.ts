import { and, desc, eq } from 'drizzle-orm'

import {
  files,
  workspace,
  teams,
  teamSites,
  siteHostnames,
  staticSiteFiles,
  staticSites,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** What serving and the dashboard look up: by label, file, branch and team. */

export namespace findSiteByLabel {
  /** What an address serves, with who owns it. */
  export interface Site {
    label: string
    linkKind: 'commit' | 'branch'
    versionId: string
    commitSha: string
    entryPath: string
    site: { id: string; name: string; kind: string; slug: string; spa: boolean }
    team: { id: string; slug: string; name: string }
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
      site: teamSites,
      team: teams,
      workspace: workspace,
    })
    .from(siteHostnames)
    .innerJoin(staticSites, eq(staticSites.id, siteHostnames.staticSiteId))
    .innerJoin(teamSites, eq(teamSites.id, siteHostnames.teamSiteId))
    .innerJoin(teams, eq(teams.id, teamSites.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
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
    team: { id: row.team.id, slug: row.team.slug, name: row.team.name },
    workspace: { id: row.workspace.id, slug: row.workspace.slug, name: row.workspace.name },
  }
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

export namespace listTeamSites {
  export interface Listing {
    name: string
    kind: string
    slug: string
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

/** Every site of a team with its newest versions and the branches that have an address. */
export async function listTeamSites(
  db: Database,
  teamId: string,
): Promise<listTeamSites.Listing[]> {
  const sites = await db.select().from(teamSites).where(eq(teamSites.teamId, teamId))
  const result: listTeamSites.Listing[] = []
  for (const site of sites) {
    // eslint-disable-next-line no-await-in-loop -- a team has a handful of sites
    const versions = await db
      .select()
      .from(staticSites)
      .where(eq(staticSites.teamSiteId, site.id))
      .orderBy(desc(staticSites.createdAt))
      .limit(30)
    // eslint-disable-next-line no-await-in-loop
    const hostnames = await db
      .select()
      .from(siteHostnames)
      .where(eq(siteHostnames.teamSiteId, site.id))
    const byVersion = new Map(
      hostnames.filter((h) => h.linkKind === 'commit').map((h) => [h.staticSiteId, h.label]),
    )
    const commitOf = new Map(versions.map((v) => [v.id, v.commitSha]))
    result.push({
      name: site.name,
      kind: site.kind,
      slug: site.slug,
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
  teamId: string,
  name: string,
  branch: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ commitSha: staticSites.commitSha })
    .from(siteHostnames)
    .innerJoin(teamSites, eq(teamSites.id, siteHostnames.teamSiteId))
    .innerJoin(staticSites, eq(staticSites.id, siteHostnames.staticSiteId))
    .where(
      and(
        eq(teamSites.teamId, teamId),
        eq(teamSites.name, name),
        eq(siteHostnames.linkKind, 'branch'),
        eq(siteHostnames.branch, branch),
      ),
    )
  return row?.commitSha
}
