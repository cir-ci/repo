import { Button, HistoryIcon, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { changesOf, historyLabel } from '#features/baselines/api.ts'
import { snapshotHistoryQuery } from '#features/triage/api.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { screenshotStatus, shotReview } from './diff-status.ts'

import styles from './Discussion.module.css'

/** How many of the changes show before "Show all". */
const SHOWN = 3

/** How many recent builds of the default branch the history looks through. */
const LOOK_BACK = 20

/**
 * The screenshot on screen, through recent builds of the default branch: each build that changed
 * it, how, and who approved it ("Changed, approved by Maya Levi"), newest first, linking to that
 * build. What the header can't hold: whether this change is the screenshot's usual churn.
 */
export function ScreenshotHistory({
  workspace,
  project,
  name,
  defaultBranch,
}: ScreenshotHistory.Props) {
  const clientLink = useClientLink()
  const { data } = useQuery(snapshotHistoryQuery(workspace, project, name, undefined, LOOK_BACK))
  const [all, setAll] = useState<string | undefined>(undefined)
  if (!data) return null
  const changes = changesOf(data.default)
  // The latest few; the rest wait behind "Show all" (for this screenshot only: another one starts short).
  const expanded = all === name
  const shown = expanded ? changes : changes.slice(0, SHOWN)
  return (
    <section aria-label={`History of ${name}`}>
      <Text variant="micro" tone="tertiary">
        This screenshot on {defaultBranch}
      </Text>
      {changes.length === 0 ? (
        <Text as="p" tone="secondary" className={styles.historyEmpty}>
          <HistoryIcon size={14} aria-hidden="true" />
          {`Unchanged in the last ${data.default.length} builds`}
        </Text>
      ) : (
        <ul className={styles.list}>
          {shown.map((entry) => (
            <li key={entry.build.number} className={styles.event}>
              <StatusIcon
                status={screenshotStatus(entry.status ?? 'unchanged', shotReview(entry.build))}
                size={14}
                decorative
              />
              <div className={styles.eventBody}>
                <Text>
                  <a
                    className={styles.historyLink}
                    {...clientLink({
                      to: '/$workspace/$project/builds/$number',
                      params: { workspace, project, number: String(entry.build.number) },
                      search: { shot: name },
                    })}
                  >
                    Build #{entry.build.number}
                  </a>{' '}
                  {historyLabel(entry)}
                </Text>
                <Text variant="small" tone="tertiary">
                  <RelativeTime iso={entry.build.createdAt} />
                </Text>
              </div>
            </li>
          ))}
        </ul>
      )}
      {changes.length > SHOWN ? (
        <Button
          variant="link"
          aria-expanded={expanded}
          onClick={() => setAll(expanded ? undefined : name)}
        >
          {expanded ? 'Show fewer' : `Show all ${changes.length}`}
        </Button>
      ) : null}
    </section>
  )
}

export namespace ScreenshotHistory {
  export interface Props {
    workspace: string
    project: string
    /** The screenshot on screen. */
    name: string
    defaultBranch: string
  }
}
