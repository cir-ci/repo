import { isSha256 } from '@circi/core'
import {
  type Database,
  ensureAssetFiles,
  publishSiteVersion,
  servedCommitForBranch,
} from '@circi/db'

/**
 * Publishes an uploaded site: records its blobs, decides whether the branch address moves to
 * this version, and creates the version with its addresses, all in one transaction.
 *
 * Whether the branch address moves (PLAN §7.6 "Branch-link rules"): only for the branch's tip,
 * never for a fork. With no tip, a local ancestry check can stand in.
 */
export async function publishSite(
  db: Database,
  input: publishSite.Input,
): Promise<publishSiteVersion.Result> {
  const commitSha = input.commitSha.toLowerCase()
  return db.transaction(async (tx) => {
    // Unique blobs: identical files are stored once, whatever their paths.
    const unique = new Map(input.files.map((f) => [f.sha256, f]))
    await ensureAssetFiles(
      tx,
      [...unique.values()].map((f) => ({
        sha256: f.sha256,
        size: f.size,
        storageKey: input.storageKeys.get(f.sha256) ?? input.fallbackKey(f.sha256),
        contentType: f.contentType,
      })),
    )

    let moveBranch = false
    if (input.branch && !input.fork) {
      if (input.branchTip && isSha256(input.branchTip.padEnd(64, '0').slice(0, 64))) {
        moveBranch = input.branchTip.toLowerCase() === commitSha
      } else if (input.descends) {
        const served = await servedCommitForBranch(tx, input.teamId, input.name, input.branch)
        // No address yet: this upload starts the branch's address.
        moveBranch = served === undefined || input.descends
      }
    }

    return publishSiteVersion(tx, {
      teamId: input.teamId,
      name: input.name,
      kind: input.kind,
      spa: input.spa,
      commitSha,
      branch: input.branch ?? null,
      moveBranch,
      entryPath: input.entryPath,
      files: input.files,
      slugPrefix: input.slugPrefix,
      addressing: input.addressing,
    })
  })
}

export namespace publishSite {
  export interface Input {
    teamId: string
    name: string
    kind: string
    spa: boolean
    commitSha: string
    branch?: string | undefined
    /** What `git ls-remote` says the branch points at. */
    branchTip?: string | undefined
    /** The uploader checked that this commit descends from the one the branch address serves. */
    descends?: boolean | undefined
    /** From a fork's pull request: never moves a branch address. */
    fork?: boolean | undefined
    entryPath: string
    files: publishSiteVersion.File[]
    /** The storage key each blob was written under, by hash. */
    storageKeys: ReadonlyMap<string, string>
    /** The key for a blob with no entry in `storageKeys`. */
    fallbackKey: (sha256: string) => string
    slugPrefix: string
    addressing: publishSiteVersion.Addressing
  }
}
