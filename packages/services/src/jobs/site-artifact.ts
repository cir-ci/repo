import { Readable } from 'node:stream'

import { ValidationError } from '@circi/core'
import { type Database, type Job } from '@circi/db'
import { findWorkspaceById, getProjectById, servedCommitForBranch } from '@circi/db/queries'
import { findArtifactImport, recordArtifactImport } from '@circi/db/repositories'
import {
  type IntegrationDefinition,
  type IntegrationRegistry,
  integrationRegistry,
} from '@circi/integrations'
import { IngestError, ingestZip } from '@circi/sites'
import { contentKey, type StorageDriver } from '@circi/storage'

import { publishSiteFiles } from '#src/sites/publish-files.ts'

/**
 * The `site-artifact` job: a GitHub Actions run finished, so publish the site its artifact holds
 * (`actions/upload-artifact`, no CirCI step in the workflow). The settings are read again here,
 * since they may have changed since the webhook; a project that turned the setting off meanwhile
 * gets nothing. The artifact goes through the same reader and limits as `circi site upload`
 * (a zip instead of a tarball) and the same publishing step.
 *
 * Idempotent per run attempt (`site_artifact_imports`): a redelivered webhook or a retried job
 * finds the attempt published and stops. A problem a person must fix (no such artifact, too big,
 * not a site, the App lacking `Actions: read`) is recorded as the attempt's note and ends the job,
 * since retrying can't help; a transient failure (GitHub 5xx, the network) throws so the queue
 * retries with backoff, and `noteGiveUp` records it if every attempt fails. Nothing here logs a
 * token: the host's adapter keeps them.
 */

export namespace importSiteArtifact {
  export interface Deps {
    db: Database
    storage: StorageDriver
    context: IntegrationDefinition.Context
    /** The instance's limit on a site's unpacked size, in bytes, as it is now. */
    maxBytes: () => Promise<number>
    registry?: IntegrationRegistry
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    | { status: 'published'; files: number; commitSha: string }
    | { status: 'failed'; reason: string }
}

interface Payload {
  projectId: string
  kind: string
  externalId: string
  repo: string
  runId: string
  runAttempt: number
  headSha: string
  headBranch?: string
  prNumber?: number
  fork: boolean
}

function payloadOf(raw: Record<string, unknown>): Payload | undefined {
  const { projectId, kind, externalId, repo, runId, runAttempt, headSha } = raw
  if (
    typeof projectId !== 'string' ||
    typeof kind !== 'string' ||
    typeof externalId !== 'string' ||
    typeof repo !== 'string' ||
    typeof runId !== 'string' ||
    typeof runAttempt !== 'number' ||
    typeof headSha !== 'string'
  ) {
    return undefined
  }
  return {
    projectId,
    kind,
    externalId,
    repo,
    runId,
    runAttempt,
    headSha,
    fork: raw.fork === true,
    ...(typeof raw.headBranch === 'string' ? { headBranch: raw.headBranch } : {}),
    ...(typeof raw.prNumber === 'number' ? { prNumber: raw.prNumber } : {}),
  }
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

async function note(
  db: Database,
  p: Payload,
  status: 'published' | 'failed',
  message: string,
  artifactId?: string,
) {
  await db.transaction((tx) =>
    recordArtifactImport(tx, {
      projectId: p.projectId,
      runId: p.runId,
      runAttempt: p.runAttempt,
      status,
      artifactId,
      commitSha: p.headSha,
      message,
    }),
  )
}

export async function importSiteArtifact(
  deps: importSiteArtifact.Deps,
  job: Job,
): Promise<importSiteArtifact.Result> {
  const p = payloadOf(job.payload)
  if (!p) return { status: 'skipped', reason: 'malformed job' }
  const { db } = deps
  const project = await getProjectById(db, p.projectId)
  if (!project) return { status: 'skipped', reason: 'project was deleted' }
  if (!project.staticHostingEnabled || !project.sitesFromActions) {
    return { status: 'skipped', reason: 'sites from GitHub Actions is off for this project' }
  }
  const earlier = await findArtifactImport(db, p)
  if (earlier?.status === 'published') {
    return { status: 'skipped', reason: 'this run was already published' }
  }
  const artifacts = (deps.registry ?? integrationRegistry).get(p.kind)?.capabilities.runArtifacts
  if (!artifacts) return { status: 'skipped', reason: `${p.kind} has no CI artifacts` }
  const workspace = await findWorkspaceById(db, project.workspaceId)
  if (!workspace) return { status: 'skipped', reason: 'workspace was deleted' }

  const failed = async (message: string): Promise<importSiteArtifact.Result> => {
    await note(db, p, 'failed', message)
    return { status: 'failed', reason: message }
  }

  const maxBytes = await deps.maxBytes()
  const name = project.sitesArtifactName
  // A transient failure throws from here: the queue retries it.
  const found = await artifacts.fetch(
    {
      connection: { externalId: p.externalId },
      repo: p.repo,
      runId: p.runId,
      name,
      maxBytes,
    },
    deps.context,
  )
  if (found.status === 'missing') {
    const has =
      found.available.length > 0
        ? `It has: ${found.available.map((n) => `"${n}"`).join(', ')}.`
        : 'It has no artifacts.'
    return failed(
      `Run ${p.runId} has no artifact named "${name}". ${has} Check the name in the upload-artifact step and in the project settings.`,
    )
  }
  if (found.status === 'expired') {
    return failed(
      `The artifact "${name}" of run ${p.runId} has expired on GitHub: re-run the workflow.`,
    )
  }
  if (found.status === 'too_large') {
    return failed(
      `The artifact "${name}" is ${megabytes(found.bytes)}, above this instance's limit of ${megabytes(maxBytes)} for a site.`,
    )
  }
  if (found.status === 'denied') return failed(found.message)

  const keys = new Map<string, string>()
  let published: publishSiteFiles.Result
  try {
    const files = await ingestZip(found.data, {
      maxBytes,
      store: async (file, content) => {
        if (keys.has(file.sha256)) return
        const key = contentKey(file.sha256)
        keys.set(file.sha256, key)
        await deps.storage.put(key, Readable.from([content]), {
          expectedSha256: file.sha256,
          contentType: file.contentType,
        })
      },
    })
    // The branch address follows the branch's tip, as `circi site upload` asks git. Without a
    // tip, only a branch with no address yet is taken.
    const branch = p.headBranch
    const tip =
      branch && !p.fork
        ? await artifacts.branchTip(
            { connection: { externalId: p.externalId }, repo: p.repo, branch },
            deps.context,
          )
        : null
    const siteName = project.sitesArtifactSiteName ?? 'site'
    const free =
      branch && !p.fork && !tip
        ? (await servedCommitForBranch(db, project.id, siteName, branch)) === undefined
        : false
    published = await publishSiteFiles(db, {
      project: { id: project.id, slug: project.slug, workspaceSlug: workspace.slug },
      name: siteName,
      commitSha: p.headSha,
      branch,
      branchTip: tip ?? undefined,
      descends: free || undefined,
      fork: p.fork,
      files,
      storageKeys: keys,
    })
  } catch (err) {
    if (err instanceof IngestError || err instanceof ValidationError) {
      return failed(`The artifact "${name}" couldn't be published: ${err.message}`)
    }
    throw err
  }
  await note(
    db,
    p,
    'published',
    `Published ${published.site.name} for ${p.headSha.slice(0, 7)} from run ${p.runId}.`,
    found.artifactId,
  )
  return { status: 'published', files: published.version.fileCount, commitSha: p.headSha }
}

/** After the last attempt failed (GitHub kept failing): says so in the project's settings. */
export async function noteSiteArtifactGiveUp(
  db: Database,
  job: Job,
  message: string,
): Promise<void> {
  const p = payloadOf(job.payload)
  if (!p) return
  await note(
    db,
    p,
    'failed',
    `GitHub couldn't be reached after several tries (${message}). Re-run the workflow to try again.`,
  )
}
