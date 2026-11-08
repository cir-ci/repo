import { createHash, randomBytes } from 'node:crypto'

import { ValidationError } from '@circi/core'
import { and, desc, eq, gt, inArray, like, lt, sql } from 'drizzle-orm'

import {
  files,
  member,
  workspace,
  teams,
  teamSites,
  session,
  siteHostnames,
  siteSessions,
  siteTokens,
  staticSiteFiles,
  staticSites,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Hosted static sites (PLAN §7.6): publishing a version, the addresses that point at versions,
 * and the lookups serving needs. Address and slug *algorithms* live in `@circi/sites`; they are
 * passed in so the database package stays free of it.
 */

export namespace publishSiteVersion {
  export interface File {
    path: string
    sha256: string
    size: number
    contentType: string
  }

  export interface Addressing {
    /** The slug to use when a site is first created: tries `taken` until one is free. */
    chooseSlug(taken: (slug: string) => boolean): string
    /** A commit address's label (12 or 16 hash characters + slug). */
    commitLabel(slug: string, exists: (label: string) => boolean): string
    /** A branch address's label. */
    branchLabel(branch: string, slug: string, exists: (label: string) => boolean): string
  }
}

export async function ensureAssetFiles(
  db: Database,
  input: { sha256: string; size: number; storageKey: string; contentType: string }[],
): Promise<void> {
  if (input.length === 0) return
  await db
    .insert(files)
    .values(
      input.map((f) => ({
        sha256: f.sha256,
        storageKey: f.storageKey,
        kind: 'asset' as const,
        status: 'verified' as const,
        size: f.size,
        contentType: f.contentType,
        verifiedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: files.sha256,
      // Bytes written by the server are verified by construction (it hashed them itself). A
      // file that was already verified keeps the copy it has; one that was only announced (or
      // never arrived) now points at the copy just written.
      set: {
        storageKey: sql`case when ${files.status} = 'verified' then ${files.storageKey} else excluded.storage_key end`,
        status: 'verified',
        verifiedAt: new Date(),
      },
    })
}

export async function publishSiteVersion(
  db: Database,
  input: publishSiteVersion.Input,
): Promise<publishSiteVersion.Result> {
  if (!/^[0-9a-f]{12,64}$/.test(input.commitSha)) {
    throw new ValidationError(
      'Hosting a site needs the full commit SHA (at least 12 hex characters)',
    )
  }
  return db.transaction(async (tx) => {
    // 1. The site: found by name, or created with a free slug.
    let [site] = await tx
      .select()
      .from(teamSites)
      .where(and(eq(teamSites.teamId, input.teamId), eq(teamSites.name, input.name)))
    if (site) {
      if (site.kind !== input.kind || site.spa !== input.spa) {
        ;[site] = await tx
          .update(teamSites)
          .set({ kind: input.kind, spa: input.spa })
          .where(eq(teamSites.id, site.id))
          .returning()
      }
    } else {
      const probe = input.slugPrefix
      const rows = await tx
        .select({ slug: teamSites.slug })
        .from(teamSites)
        .where(like(teamSites.slug, `${probe}%`))
      const used = new Set(rows.map((r) => r.slug))
      const slug = input.addressing.chooseSlug((s) => used.has(s))
      ;[site] = await tx
        .insert(teamSites)
        .values({
          teamId: input.teamId,
          name: input.name,
          kind: input.kind,
          slug,
          spa: input.spa,
        })
        .returning()
    }
    if (!site) throw new Error('site vanished')

    // 2. The version for this commit: replaced in place on a CI re-run, so every address that
    //    points at it keeps working and now shows the new files.
    const totalBytes = input.files.reduce((n, f) => n + f.size, 0)
    const [existing] = await tx
      .select()
      .from(staticSites)
      .where(and(eq(staticSites.teamSiteId, site.id), eq(staticSites.commitSha, input.commitSha)))
    let version = existing
    if (version) {
      await tx.delete(staticSiteFiles).where(eq(staticSiteFiles.staticSiteId, version.id))
      ;[version] = await tx
        .update(staticSites)
        .set({
          branch: input.branch,
          entryPath: input.entryPath,
          totalBytes,
          fileCount: input.files.length,
          createdAt: new Date(),
        })
        .where(eq(staticSites.id, version.id))
        .returning()
    } else {
      ;[version] = await tx
        .insert(staticSites)
        .values({
          teamSiteId: site.id,
          commitSha: input.commitSha,
          branch: input.branch,
          entryPath: input.entryPath,
          totalBytes,
          fileCount: input.files.length,
        })
        .returning()
    }
    if (!version) throw new Error('version vanished')
    const versionId = version.id
    for (let i = 0; i < input.files.length; i += 500) {
      // eslint-disable-next-line no-await-in-loop -- batches keep each statement small
      await tx.insert(staticSiteFiles).values(
        input.files.slice(i, i + 500).map((f) => ({
          staticSiteId: versionId,
          path: f.path,
          sha256: f.sha256,
          size: f.size,
          contentType: f.contentType,
        })),
      )
    }

    // 3. Addresses. The label namespace is global, so "taken" is a lookup.
    const labelsTaken = async (candidates: string[]) => {
      const rows = await tx
        .select({ label: siteHostnames.label })
        .from(siteHostnames)
        .where(inArray(siteHostnames.label, candidates))
      return new Set(rows.map((r) => r.label))
    }
    const [commitRow] = await tx
      .select()
      .from(siteHostnames)
      .where(and(eq(siteHostnames.staticSiteId, versionId), eq(siteHostnames.linkKind, 'commit')))
    let commitLabel = commitRow?.label
    if (!commitLabel) {
      const probe = input.addressing.commitLabel(site.slug, () => false)
      const long = input.addressing.commitLabel(site.slug, () => true)
      const taken = await labelsTaken([probe, long])
      commitLabel = input.addressing.commitLabel(site.slug, (l) => taken.has(l))
      await tx.insert(siteHostnames).values({
        label: commitLabel,
        teamSiteId: site.id,
        linkKind: 'commit',
        staticSiteId: versionId,
      })
    }

    let branchLabel: string | undefined
    if (input.branch && input.moveBranch) {
      const [branchRow] = await tx
        .select()
        .from(siteHostnames)
        .where(
          and(
            eq(siteHostnames.teamSiteId, site.id),
            eq(siteHostnames.linkKind, 'branch'),
            eq(siteHostnames.branch, input.branch),
          ),
        )
      if (branchRow) {
        branchLabel = branchRow.label
        await tx
          .update(siteHostnames)
          .set({ staticSiteId: versionId, updatedAt: new Date() })
          .where(eq(siteHostnames.label, branchRow.label))
      } else {
        const short = input.addressing.branchLabel(input.branch, site.slug, () => false)
        const long = input.addressing.branchLabel(input.branch, site.slug, () => true)
        const taken = await labelsTaken([short, long])
        branchLabel = input.addressing.branchLabel(input.branch, site.slug, (l) => taken.has(l))
        await tx.insert(siteHostnames).values({
          label: branchLabel,
          teamSiteId: site.id,
          linkKind: 'branch',
          branch: input.branch,
          staticSiteId: versionId,
        })
      }
    }
    return {
      site: { id: site.id, name: site.name, kind: site.kind, slug: site.slug, spa: site.spa },
      version: {
        id: versionId,
        commitSha: input.commitSha,
        fileCount: input.files.length,
        totalBytes,
      },
      commitLabel,
      ...(branchLabel ? { branchLabel } : {}),
      replaced: existing !== undefined,
    }
  })
}

export namespace publishSiteVersion {
  export interface Input {
    teamId: string
    name: string
    kind: string
    spa: boolean
    commitSha: string
    branch: string | null
    /** Whether the branch address should now serve this version (the caller checked the tip). */
    moveBranch: boolean
    entryPath: string
    files: publishSiteVersion.File[]
    addressing: publishSiteVersion.Addressing
    /** A prefix every candidate slug starts with, to preload the slugs that might clash. */
    slugPrefix: string
  }

  export interface Result {
    site: { id: string; name: string; kind: string; slug: string; spa: boolean }
    version: { id: string; commitSha: string; fileCount: number; totalBytes: number }
    commitLabel: string
    branchLabel?: string
    /** A CI re-run replaced an earlier version of the same commit. */
    replaced: boolean
  }
}

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

// ---- sign-in handoff -------------------------------------------------------------------------

const TOKEN_TTL_MS = 60_000
export const SITE_SESSION_TTL_MS = 60 * 60_000

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** A single-use token for one address, 60 seconds; only its hash is kept. */
export async function createSiteToken(
  db: Database,
  input: { label: string; userId: string; authSessionId: string },
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.delete(siteTokens).where(lt(siteTokens.expiresAt, new Date()))
  await db.insert(siteTokens).values({
    tokenHash: hash(token),
    label: input.label,
    userId: input.userId,
    authSessionId: input.authSessionId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  })
  return token
}

/**
 * Spends a token: valid once, for the address it was made for, within its minute. The deletion is
 * the check, so two requests racing with one token can't both win.
 */
export async function consumeSiteToken(
  db: Database,
  token: string,
  label: string,
): Promise<{ userId: string; authSessionId: string } | undefined> {
  const [row] = await db
    .delete(siteTokens)
    .where(
      and(
        eq(siteTokens.tokenHash, hash(token)),
        eq(siteTokens.label, label),
        gt(siteTokens.expiresAt, new Date()),
      ),
    )
    .returning()
  return row ? { userId: row.userId, authSessionId: row.authSessionId } : undefined
}

export async function createSiteSession(
  db: Database,
  input: { label: string; userId: string; authSessionId: string },
): Promise<string> {
  const id = randomBytes(24).toString('base64url')
  await db.delete(siteSessions).where(lt(siteSessions.expiresAt, new Date()))
  await db.insert(siteSessions).values({
    id,
    label: input.label,
    userId: input.userId,
    authSessionId: input.authSessionId,
    expiresAt: new Date(Date.now() + SITE_SESSION_TTL_MS),
  })
  return id
}

/**
 * Whether a site session still stands for a person who may open this address: the session
 * exists for this address and hasn't expired, the dashboard session behind it is still valid,
 * and the person still belongs to the site's workspace.
 */
export async function siteSessionValid(
  db: Database,
  input: { id: string; label: string; workspaceId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ userId: siteSessions.userId })
    .from(siteSessions)
    .innerJoin(session, eq(session.id, siteSessions.authSessionId))
    .innerJoin(
      member,
      and(eq(member.userId, siteSessions.userId), eq(member.workspaceId, input.workspaceId)),
    )
    .where(
      and(
        eq(siteSessions.id, input.id),
        eq(siteSessions.label, input.label),
        gt(siteSessions.expiresAt, new Date()),
        gt(session.expiresAt, new Date()),
      ),
    )
  return row !== undefined
}

/** Slides a site session's expiry forward (the cookie lives an hour from the last use). */
export async function touchSiteSession(db: Database, id: string): Promise<void> {
  await db
    .update(siteSessions)
    .set({ expiresAt: new Date(Date.now() + SITE_SESSION_TTL_MS) })
    .where(eq(siteSessions.id, id))
}
