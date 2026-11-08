import { type Database, schema } from '@circi/db'

import { seedFile } from './screenshots.ts'

let n = 0

/**
 * A hosted site with one version and, unless `label` is false, one commit address, inserted
 * directly (publishing goes through `publishSiteVersion`, which needs the `@circi/sites`
 * addressing rules this package can't depend on).
 */
export async function seedSite(
  db: Database,
  input: {
    projectId: string
    name?: string
    kind?: string
    commitSha?: string
    branch?: string | null
    files?: { path: string; sha256: string; size?: number; contentType?: string }[]
    label?: string | false
  },
) {
  n += 1
  const slug = `site${n}`
  const [site] = await db
    .insert(schema.projectSites)
    .values({
      projectId: input.projectId,
      name: input.name ?? `site-${n}`,
      kind: input.kind ?? 'generic',
      slug,
    })
    .returning()
  const siteFiles = input.files ?? []
  const [version] = await db
    .insert(schema.staticSites)
    .values({
      projectSiteId: site?.id ?? '',
      commitSha: input.commitSha ?? 'abcdef012345',
      branch: input.branch ?? null,
      totalBytes: siteFiles.reduce((sum, f) => sum + (f.size ?? 1), 0),
      fileCount: siteFiles.length,
    })
    .returning()
  if (!site || !version) throw new Error('seed insert returned no row')
  for (const f of siteFiles) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of files
    await seedFile(db, { sha256: f.sha256, kind: 'asset' })
    // oxlint-disable-next-line no-await-in-loop
    await db.insert(schema.staticSiteFiles).values({
      staticSiteId: version.id,
      path: f.path,
      sha256: f.sha256,
      size: f.size ?? 1,
      contentType: f.contentType ?? 'text/html',
    })
  }
  const label =
    input.label === undefined ? `${slug}-${version.commitSha.slice(0, 12)}` : input.label
  if (label) {
    await db.insert(schema.siteHostnames).values({
      label,
      projectSiteId: site.id,
      linkKind: 'commit',
      staticSiteId: version.id,
    })
  }
  return { site, version, label: label || undefined }
}
