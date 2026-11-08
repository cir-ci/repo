import { defaultIssueTitle, issueDescription, ValidationError } from '@circi/core'
import {
  type Database,
  getBuild,
  getBuildDetail,
  getProjectContext,
  getProjectTracker,
  insertIssueLink,
  type IssueLink,
  listBuildReviews,
  NotFoundError,
} from '@circi/db'

/**
 * Creates an issue in a tracker (Linear, Jira) from a build or one of its snapshots and records
 * the link, which the build page and its activity show. The tracker is called first and the link
 * stored only once it answered: a failed call stores nothing (and rethrows), so no build ever
 * shows an issue that does not exist.
 */

export const MAX_ISSUE_TITLE_LENGTH = 250

export async function createIssueFromBuild(
  db: Database,
  input: createIssueFromBuild.Input,
): Promise<IssueLink.Record> {
  const build = await getBuild(db, input.buildId)
  if (!build) throw new NotFoundError('Build not found')
  const context = await getProjectContext(db, build.projectId)
  if (!context) throw new NotFoundError('Build not found')
  const mapped = await getProjectTracker(db, build.projectId, input.integrationId)
  if (!mapped) throw new NotFoundError('This project does not file issues in that tracker')
  const tracker = input.openTracker(mapped.integration)
  if (!tracker) {
    throw new ValidationError('That tracker connection cannot be used; connect it again')
  }

  const snapshotName = input.snapshotName ?? null
  const detail = await getBuildDetail(db, build.projectId, build.number)
  const shot = snapshotName ? detail?.diffs.find((d) => d.name === snapshotName) : undefined
  if (snapshotName && !shot) throw new NotFoundError('Snapshot not found')
  const imageSha = shot?.diff?.sha256 ?? shot?.head?.sha256 ?? null

  const rejection = (await listBuildReviews(db, build.id)).find((r) => r.state === 'rejected')
  const buildUrl = `${input.publicOrigin}/${context.orgSlug}/${context.project.slug}/builds/${build.number}`
  const title = input.title?.trim() || defaultIssueTitle(snapshotName, build.number)
  if (title.length > MAX_ISSUE_TITLE_LENGTH) {
    throw new ValidationError(`title: at most ${MAX_ISSUE_TITLE_LENGTH} characters`)
  }
  const imageUrl = imageSha ? `${input.publicOrigin}/api/files/${imageSha}` : undefined
  const created = await tracker.createIssue({
    target: mapped.externalRef,
    title,
    description: issueDescription({
      number: build.number,
      project: `${context.orgSlug}/${context.project.slug}`,
      branch: build.branch,
      prNumber: build.prNumber,
      commitSha: build.commitSha,
      author: build.authorLogin,
      buildUrl: snapshotName ? `${buildUrl}?shot=${encodeURIComponent(snapshotName)}` : buildUrl,
      snapshotName,
      rejection: rejection ? { by: rejection.userName, reason: rejection.reason } : null,
      imageUrl: imageUrl ?? null,
    }),
    ...(imageUrl ? { imageUrl } : {}),
  })
  return insertIssueLink(db, {
    buildId: build.id,
    snapshotName,
    integrationId: input.integrationId,
    issueKey: created.key,
    url: created.url,
    title: created.title,
    createdBy: input.userId,
  })
}

export namespace createIssueFromBuild {
  /** What the service needs of a tracker adapter (`IssueTracker` in `@circi/providers`). */
  export interface Tracker {
    createIssue(input: {
      target: string
      title: string
      description: string
      imageUrl?: string
    }): Promise<{ key: string; url: string; title: string }>
  }

  export interface Input {
    buildId: string
    /** The screenshot the issue is about; the whole build when absent. */
    snapshotName?: string | undefined
    /** The tracker integration; the project must be mapped to it. */
    integrationId: string
    /** Default: `Visual regression: <snapshot> in build #N`. */
    title?: string | undefined
    userId: string
    /** Dashboard origin (`PUBLIC_URL`), for the links in the description. */
    publicOrigin: string
    /** Builds the adapter from the integration's sealed credentials; undefined when they cannot be used. */
    openTracker(integration: {
      kind: string
      encryptedCredentials: string | null
    }): Tracker | undefined
  }
}
