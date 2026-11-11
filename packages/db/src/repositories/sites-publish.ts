import { ValidationError } from '@circi/core'
import { and, eq, inArray, like, sql } from 'drizzle-orm'

import { files, projectSites, siteHostnames, staticSiteFiles, staticSites } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Publishing a site version: its files and the addresses that point at it. */

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
      .from(projectSites)
      .where(and(eq(projectSites.projectId, input.projectId), eq(projectSites.name, input.name)))
    if (site) {
      if (site.kind !== input.kind || site.spa !== input.spa) {
        ;[site] = await tx
          .update(projectSites)
          .set({ kind: input.kind, spa: input.spa })
          .where(eq(projectSites.id, site.id))
          .returning()
      }
    } else {
      const probe = input.slugPrefix
      const rows = await tx
        .select({ slug: projectSites.slug })
        .from(projectSites)
        .where(like(projectSites.slug, `${probe}%`))
      const used = new Set(rows.map((r) => r.slug))
      const slug = input.addressing.chooseSlug((s) => used.has(s))
      ;[site] = await tx
        .insert(projectSites)
        .values({
          projectId: input.projectId,
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
      .where(
        and(eq(staticSites.projectsiteId, site.id), eq(staticSites.commitSha, input.commitSha)),
      )
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
          projectsiteId: site.id,
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
        projectsiteId: site.id,
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
            eq(siteHostnames.projectsiteId, site.id),
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
          projectsiteId: site.id,
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
    projectId: string
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
