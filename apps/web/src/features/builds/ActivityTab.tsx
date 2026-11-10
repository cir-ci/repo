import { Avatar, Banner, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { activityQuery } from '#features/builds/api/discussion.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { timelineItems } from './timeline.ts'

import styles from './Discussion.module.css'

/** What happened to the build, oldest first: uploads, checks, requests, reviews and comments. */
export function ActivityTab({ workspace, team, number, onOpenComment }: ActivityTab.Props) {
  const { data, error, isPending } = useQuery(activityQuery(workspace, team, number))
  if (error) return <Banner tone="danger">{error.message}</Banner>
  if (isPending) {
    return (
      <Text tone="secondary" role="status">
        Loading activity…
      </Text>
    )
  }
  const items = timelineItems(data.events)
  if (items.length === 0) return <Text tone="secondary">Nothing has happened yet.</Text>
  return (
    <ol className={styles.list} aria-label="Activity">
      {items.map((item) => (
        <li key={item.key} className={styles.event}>
          <StatusIcon status={item.status} size={14} decorative />
          <div className={styles.eventBody}>
            <div className={styles.line}>
              {item.actor ? <Avatar name={item.actor.name} seed={item.actor.id} size={18} /> : null}
              <Text>
                {item.actor ? <strong>{item.actor.name}</strong> : null} {item.text}
              </Text>
              <Text variant="small" tone="tertiary">
                <RelativeTime iso={item.at} />
              </Text>
            </div>
            {item.quote ? (
              item.commentId ? (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => item.commentId && onOpenComment(item.commentId)}
                >
                  <Text variant="small" as="span" className={styles.quote}>
                    {item.quote}
                  </Text>
                </button>
              ) : (
                <Text variant="small" tone="secondary" as="p" className={styles.quote}>
                  {item.quote}
                </Text>
              )
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export namespace ActivityTab {
  export interface Props {
    workspace: string
    team: string
    number: number
    /** A comment line was chosen: show it in the Comments tab. */
    onOpenComment: (commentId: string) => void
  }
}
