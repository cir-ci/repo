import { ValidationError } from '@circi/core'
import type { Database } from '@circi/db'
import {
  branchHash,
  chooseSlug,
  commitHash,
  detectKind,
  isSiteKindId,
  KINDS,
  pickLabel,
  siteSlug,
} from '@circi/sites'
import { contentKey } from '@circi/storage'

import { publishSite } from './publish.ts'

/**
 * The step both ways of getting a site in share (`POST /v1/sites` and a GitHub Actions artifact):
 * the files are already read and stored, so decide the site's kind and entry page, choose its
 * addresses and publish. Throws `ValidationError` for a site with no files or no entry page.
 */
export async function publishSiteFiles(
  db: Database,
  input: publishSiteFiles.Input,
): Promise<publishSiteFiles.Result> {
  if (input.files.length === 0) throw new ValidationError('The archive contains no files')
  const paths = new Set(input.files.map((f) => f.path))
  const kind =
    input.kind === 'auto' || input.kind === undefined
      ? detectKind(paths)
      : isSiteKindId(input.kind)
        ? KINDS[input.kind]
        : KINDS.generic
  const entryPath = kind.entryPath(paths)
  if (!paths.has(entryPath)) {
    throw new ValidationError(`A ${kind.label} needs ${entryPath} at its top level`)
  }
  const commit = input.commitSha.toLowerCase()
  const { project } = input
  const published = await publishSite(db, {
    projectId: project.id,
    name: input.name,
    kind: kind.id,
    spa: input.spa ?? kind.spaFallback,
    commitSha: input.commitSha,
    branch: input.branch,
    branchTip: input.branchTip,
    descends: input.descends,
    fork: input.fork,
    entryPath,
    files: input.files,
    storageKeys: input.storageKeys,
    fallbackKey: (sha256) => contentKey(sha256),
    slugPrefix: siteSlug(`${project.slug}-${input.name}`).slice(0, 10),
    addressing: {
      chooseSlug: (taken) =>
        chooseSlug(
          { project: project.slug, name: input.name, workspace: project.workspaceSlug },
          taken,
        ),
      commitLabel: (slug, exists) => pickLabel(commitHash(commit, 16), slug, exists),
      branchLabel: (branch, slug, exists) => pickLabel(branchHash(branch, 16), slug, exists),
    },
  })
  return { ...published, kind: kind.id }
}

export namespace publishSiteFiles {
  export interface Input {
    project: { id: string; slug: string; workspaceSlug: string }
    name: string
    /** `auto` (or none) looks at the files. */
    kind?: string | undefined
    spa?: boolean | undefined
    commitSha: string
    branch?: string | undefined
    branchTip?: string | undefined
    descends?: boolean | undefined
    fork?: boolean | undefined
    files: publishSite.Input['files']
    storageKeys: ReadonlyMap<string, string>
  }
  export type Result = Awaited<ReturnType<typeof publishSite>> & { kind: string }
}
