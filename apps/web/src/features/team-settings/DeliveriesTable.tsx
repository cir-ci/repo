import type { Team } from '@circi/api'
import { SortableHeader, Text } from '@circi/ui'

import { RelativeTime } from '#lib/RelativeTime.tsx'
import type { Accessors } from '#lib/sort.ts'
import { useSorted } from '#lib/use-sorted.ts'

import { attemptLabel, deliveryAnswer } from './webhook-events.ts'

import styles from './WebhooksPage.module.css'

const COLUMNS: Accessors<Team.WebhookDelivery> = {
  time: (d) => new Date(d.createdAt),
  event: (d) => d.event,
  // A delivery with no answer (an error before one) has no status to order by.
  status: (d) => d.statusCode,
  attempt: (d) => d.attempt,
}

/** A webhook's recent deliveries, newest first until a column is pressed. */
export function DeliveriesTable({ url, deliveries }: DeliveriesTable.Props) {
  const table = useSorted(deliveries, COLUMNS)
  return (
    <div className={styles.table} role="table" aria-label={`Deliveries to ${url}`}>
      <div className={`${styles.dl} ${styles.head}`} role="row">
        <SortableHeader as="div" {...table.header('time')}>
          Time
        </SortableHeader>
        <SortableHeader as="div" {...table.header('event')}>
          Event
        </SortableHeader>
        <SortableHeader as="div" {...table.header('status')}>
          Status
        </SortableHeader>
        <SortableHeader as="div" {...table.header('attempt')}>
          Attempt
        </SortableHeader>
      </div>
      {table.rows.map((d) => {
        const answer = deliveryAnswer(d)
        return (
          <div key={`${d.deliveryId}-${d.attempt}`} className={styles.dl} role="row">
            <Text variant="small" tone="secondary" role="cell">
              <RelativeTime iso={d.createdAt} />
            </Text>
            <Text variant="mono" role="cell">
              {d.event}
              {d.test ? ' (test)' : ''}
            </Text>
            <Text variant="small" tone={answer.ok ? 'approved' : 'failed'} role="cell">
              {answer.text}
            </Text>
            <Text variant="small" tone="secondary" role="cell">
              {attemptLabel(d)}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

export namespace DeliveriesTable {
  export interface Props {
    url: string
    deliveries: Team.WebhookDelivery[]
  }
}
