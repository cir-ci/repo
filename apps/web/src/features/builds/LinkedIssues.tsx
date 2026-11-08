import type { Build } from '@circi/api'
import { Link, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { ProviderLogo } from '#features/integrations/logos.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { issuesQuery } from './issues-api.ts'

import styles from './Discussion.module.css'
import issueStyles from './Issues.module.css'

/** The Linear or Jira issues created from the build, in the Details tab. Nothing when there are none. */
export function LinkedIssues({ issues }: LinkedIssues.Props) {
  if (issues.length === 0) return null
  return (
    <div>
      <Text variant="micro" tone="tertiary">
        Issues
      </Text>
      <ul className={styles.list} aria-label="Linked issues">
        {issues.map((i) => (
          <li key={i.url}>
            <Link href={i.url} target="_blank" rel="noopener noreferrer">
              {i.key}
            </Link>{' '}
            <Text variant="small" tone="secondary">
              {i.title}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  )
}

export namespace LinkedIssues {
  export interface Props {
    issues: Build.Detail['issues']
  }
}

const TRACKER_NAMES: Record<string, string> = { linear: 'Linear', jira: 'Jira' }

/**
 * The link row under a snapshot's header: one line per issue created for that snapshot (the
 * tracker's mark, `KEY · Linear`, who and when). It appears the moment the issue is created, with
 * no toast: the result shows where the action happened. Nothing when the snapshot has none.
 */
export function SnapshotIssues({ workspace, team, number, snapshotName }: SnapshotIssues.Props) {
  const { data } = useQuery(issuesQuery(workspace, team, number))
  const issues = (data?.issues ?? []).filter((i) => i.snapshotName === snapshotName)
  if (issues.length === 0) return null
  return (
    <ul className={issueStyles.list} aria-label="Issues for this snapshot">
      {issues.map((i) => (
        <li key={i.id} className={issueStyles.row}>
          <ProviderLogo kind={i.tracker} size={24} />
          <Link href={i.url} target="_blank" rel="noopener noreferrer">
            {i.key} · {TRACKER_NAMES[i.tracker] ?? i.tracker}
          </Link>
          <Text variant="small" tone="tertiary">
            {i.createdBy ? `created by ${i.createdBy} ` : 'created '}
            <RelativeTime iso={i.createdAt} />, with the diff attached
          </Text>
        </li>
      ))}
    </ul>
  )
}

export namespace SnapshotIssues {
  export interface Props {
    workspace: string
    team: string
    number: number
    /** The selected snapshot; null for issues about the whole build. */
    snapshotName: string | null
  }
}
