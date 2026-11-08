import type { Build } from '@circi/api'
import { Link, Text } from '@circi/ui'

import styles from './Discussion.module.css'

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
            <Link href={i.url} target="_blank" rel="noreferrer">
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
