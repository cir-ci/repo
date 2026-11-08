import { Banner, SectionHeader, Switch } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { PREFERENCE_ROWS, preferencesQuery, useSetPreference } from './api.ts'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/** Which emails a person gets besides the Inbox. Each switch saves as it flips. */
export function NotificationsPage() {
  useDocumentTitle('Notifications')
  const { data, error, refetch } = useQuery(preferencesQuery())
  const set = useSetPreference()

  return (
    <Frame
      crumbs={['Account', 'Notifications']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {data ? (
        <section className={styles['section']}>
          <SectionHeader
            title="Email"
            description="The Inbox always has every notification. Emails are only sent when this CirCI server can send mail."
          />
          <div className={styles['fields']}>
            {PREFERENCE_ROWS.map((row) => (
              <Switch
                key={row.key}
                label={row.label}
                description={row.description}
                checked={data[row.key]}
                onCheckedChange={(on) => set.mutate({ [row.key]: on })}
              />
            ))}
          </div>
          {set.error ? (
            <Banner tone="danger">Couldn’t save that: {set.error.message}</Banner>
          ) : null}
        </section>
      ) : null}
    </Frame>
  )
}
