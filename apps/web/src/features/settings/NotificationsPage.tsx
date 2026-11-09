import { Banner, SectionHeader, Switch, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { PREFERENCE_ROWS, preferencesQuery, useSetPreference } from './api.ts'
import { Box, BoxRow } from './Box.tsx'
import { Frame } from './Frame.tsx'

import styles from './Settings.module.css'

/** What always lands in the Inbox; static, since none of it can be switched off. */
const IN_INBOX: readonly { title: string; help: string }[] = [
  {
    title: 'Review requested',
    help: 'Someone, or a review rule, asks you to review a build, or asks again after a new push.',
  },
  { title: 'Mentioned', help: 'Someone @mentions you in a comment on a snapshot.' },
  {
    title: 'Your build approved or rejected',
    help: 'A build you pushed was reviewed. Rejections include the reviewer’s reason.',
  },
  {
    title: 'Overdue review',
    help: 'A request to you passed the team’s review target. Sent once.',
  },
  {
    title: 'Connection needs attention',
    help: 'An integration stopped working, for example the GitHub app was uninstalled. Owners and admins only.',
  },
  {
    title: 'Flaky snapshot detected',
    help: 'A snapshot changed in 3 of the last 10 builds on the default branch. Goes to this week’s triage owner.',
  },
]

/** In-app notifications are always on; the two that need you soon can also be emailed. */
export function NotificationsPage() {
  useDocumentTitle('Notifications')
  const { data: session } = authClient.useSession()
  const { data, error, refetch } = useQuery(preferencesQuery())
  const capabilities = useQuery(capabilitiesQuery())
  const set = useSetPreference()
  // Email notifications need the server to send mail (SMTP).
  const mailConfigured = capabilities.data?.mailConfigured === true

  return (
    <Frame
      crumbs={['Account', 'Notifications']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {data ? (
        <>
          <Text as="p" tone="secondary" className={styles.intro}>
            Everything lands in your{' '}
            <Link to="/inbox" search={{ tab: 'for-you' }}>
              Inbox
            </Link>
            . Review requests also show in Reviews; acting in either one clears both.
          </Text>

          <section className={styles.section} aria-labelledby="email">
            <SectionHeader
              title={<span id="email">Email</span>}
              description="Only the two things that need you soon can be emailed. Switches apply at once."
            />
            {mailConfigured ? (
              <>
                <Box label="Email notifications">
                  {PREFERENCE_ROWS.map((row) => (
                    <BoxRow key={row.key}>
                      <Switch
                        label={row.label}
                        description={row.description}
                        checked={data[row.key]}
                        onCheckedChange={(on) => set.mutate({ [row.key]: on })}
                      />
                    </BoxRow>
                  ))}
                </Box>
                {session ? (
                  <Text variant="small" tone="tertiary">
                    Mail goes to {session.user.email}.
                  </Text>
                ) : null}
              </>
            ) : (
              <Banner>
                This server can’t send mail yet, so there are no email notifications to switch on.
                Ask an admin to set up outgoing mail.
              </Banner>
            )}
            {set.error ? (
              <Banner tone="danger">Couldn’t save that: {set.error.message}</Banner>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="inapp">
            <SectionHeader
              title={<span id="inapp">In your Inbox</span>}
              description="Always on. Snooze or delete single items from the Inbox instead."
            />
            <Box label="Notifications in your Inbox">
              {IN_INBOX.map((n) => (
                <BoxRow key={n.title} title={n.title} help={n.help} />
              ))}
            </Box>
          </section>

          <section className={styles.section} aria-labelledby="team-channels">
            <SectionHeader title={<span id="team-channels">Team channels</span>} />
            <Banner>
              Slack channels for a team are set by an admin in workspace integrations, not here.
            </Banner>
          </section>
        </>
      ) : null}
    </Frame>
  )
}
