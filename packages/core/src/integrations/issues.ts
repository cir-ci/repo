/**
 * The text of an issue CirCI files in a tracker (Linear, Jira) from a build: its title and a
 * description with where to look. Pure, so the service, the dialog's preview and tests agree.
 */

/** The `integration_links.kind` of an issue created from a build. */
export const ISSUE_LINK_KIND = 'issue'

export namespace IssueText {
  export interface BuildFacts {
    number: number
    /** The team, as `workspace/team`. */
    team: string
    branch: string | null
    prNumber: number | null
    commitSha: string
    author: string | null
    /** Link to the build in the dashboard. */
    buildUrl: string
    snapshotName: string | null
    /** The latest rejection, when there is one. */
    rejection: { by: string | null; reason: string | null } | null
    /** Where the diff (or, failing that, the new screenshot) can be opened. */
    imageUrl: string | null
  }
}

/** `Visual regression: <snapshot> in build #N` (the whole build when no snapshot is named). */
export const defaultIssueTitle = (snapshotName: string | null, buildNumber: number) =>
  snapshotName
    ? `Visual regression: ${snapshotName} in build #${buildNumber}`
    : `Visual regression in build #${buildNumber}`

/** The description: what happened, who and where, why it was rejected, and the links. */
export function issueDescription(facts: IssueText.BuildFacts): string {
  const lines: string[] = []
  lines.push(
    facts.snapshotName
      ? `The snapshot "${facts.snapshotName}" changed in build #${facts.number} of ${facts.team}.`
      : `Build #${facts.number} of ${facts.team} has visual changes.`,
  )
  const where = [
    facts.branch ? `Branch: ${facts.branch}` : null,
    facts.prNumber ? `Pull request: #${facts.prNumber}` : null,
    `Commit: ${facts.commitSha.slice(0, 7)}`,
    facts.author ? `Author: ${facts.author}` : null,
  ].filter((l): l is string => l !== null)
  lines.push(where.join('\n'))
  if (facts.rejection) {
    const by = facts.rejection.by ?? 'A reviewer'
    lines.push(
      facts.rejection.reason
        ? `${by} rejected the build: ${facts.rejection.reason}`
        : `${by} rejected the build.`,
    )
  }
  lines.push(`Build: ${facts.buildUrl}`)
  if (facts.imageUrl) lines.push(`Diff image: ${facts.imageUrl}`)
  return lines.join('\n\n')
}
