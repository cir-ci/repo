import {
  defaultIssueTitle,
  ISSUE_LINK_KIND,
  issueDescription,
  ValidationError,
  assertFound,
} from '@circi/core'
import { type Database, NotFoundError } from '@circi/db'
import {
  getBuild,
  getBuildDetail,
  getProjectContext,
  type IntegrationLink,
  listBuildReviews,
} from '@circi/db/queries'
import { createIntegrationLink, getProjectIntegration } from '@circi/db/repositories'

/**
 * Creates an issue in a tracker (Linear, Jira) from a build or one of its snapshots and records
 * the link (an `integration_links` row of kind `issue`), which the build page and its activity show. The tracker is called first and the link
 * stored only once it answered: a failed call stores nothing (and rethrows), so no build ever
 * shows an issue that does not exist.
 */

export const MAX_ISSUE_TITLE_LENGTH = 250

export async function createIssueFromBuild(
  db: Database,
  input: createIssueFromBuild.Input,
): Promise<IntegrationLink.Row> {
  const build = await getBuild(db, input.buildId)
  assertFound(build, 'Build not found')
  const context = await getProjectContext(db, build.projectId)
  assertFound(context, 'Build not found')
  const mapped = await getProjectIntegration(db, build.projectId, input.integrationId)
  assertFound(mapped, "This project doesn't file issues in that tracker")
  const tracker = input.openTracker(mapped.integration)
  if (!tracker) {
    throw new ValidationError("That tracker connection can't be used; connect it again")
  }

  const snapshotName = input.snapshotName ?? null
  const detail = await getBuildDetail(db, build.projectId, build.number)
  const shot = snapshotName ? detail?.diffs.find((d) => d.name === snapshotName) : undefined
  if (snapshotName && !shot) throw new NotFoundError('Screenshot not found')
  const imageSha = shot?.diff?.sha256 ?? shot?.head?.sha256 ?? null

  const rejection = (await listBuildReviews(db, build.id)).find((r) => r.state === 'rejected')
  const buildUrl = `${input.publicOrigin}/${context.workspaceSlug}/${context.project.slug}/builds/${build.number}`
  const title = input.title?.trim() || defaultIssueTitle(snapshotName, build.number)
  if (title.length > MAX_ISSUE_TITLE_LENGTH) {
    throw new ValidationError(`The title can have at most ${MAX_ISSUE_TITLE_LENGTH} characters`)
  }
  const imageUrl = imageSha ? `${input.publicOrigin}/api/files/${imageSha}` : undefined
  const created = await tracker.createIssue({
    target: mapped.externalRef,
    title,
    description: issueDescription({
      number: build.number,
      project: `${context.workspaceSlug}/${context.project.slug}`,
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
    // The project's mapping settings: Jira's issue type.
    ...(typeof mapped.extra.issueType === 'string' && mapped.extra.issueType
      ? { issueType: mapped.extra.issueType }
      : {}),
  })
  return db.transaction((tx) =>
    createIntegrationLink(tx, {
      integrationId: input.integrationId,
      buildId: build.id,
      kind: ISSUE_LINK_KIND,
      externalRef: created.key,
      url: created.url,
      title: created.title,
      payload: { snapshotName },
      createdBy: input.userId,
    }),
  )
}

export namespace createIssueFromBuild {
  /** What the service needs of a tracker adapter (`IssueTracker` in `@circi/integrations`). */
  export interface Tracker {
    createIssue(input: {
      target: string
      title: string
      description: string
      imageUrl?: string
      issueType?: string
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
