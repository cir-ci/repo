import type { Inbox } from '@circi/api'
import { Banner, SettingsRow, SettingsSection, Switch, Text, visuallyHidden } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { Frame } from '#features/workspace-settings/Frame.tsx'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { SaveNote } from '#lib/SaveNote.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'
import { toast } from '#lib/toast.ts'

import { PREFERENCE_ROWS, preferencesQuery, useSetPreference } from './api.ts'
import { PushSection } from './PushSection.tsx'

import styles from './NotificationsPage.module.css'

/** What always lands in the Inbox; static, since none of it can be switched off. */
const IN_INBOX: readonly { title: string; help: string }[] = [
  {
    title: 'Review requested',
    help: 'Someone, or a review rule, asks you to review a build, including again after a new push.',
  },
  { title: 'Mentioned', help: 'Someone @mentions you in a comment on a screenshot.' },
  {
    title: 'Your build was approved or rejected',
    help: "A build you pushed was reviewed. Rejections include the reviewer's reason.",
  },
  {
    title: 'Review overdue',
    help: "A review request to you has waited longer than the project's review target. Sent once.",
  },
  {
    title: 'Connection needs attention',
    help: 'An integration stopped working, for example because the GitHub App was uninstalled. Owners and admins only.',
  },
  {
    title: 'Flaky screenshot found',
    help: "A screenshot changed in 3 of the last 10 commits on the default branch. Goes to this week's triage owner.",
  },
]

/** In-app notifications are always on; the two that need you soon can also be emailed. */
export function NotificationsPage() {
  useDocumentTitle('Notifications')
  const { data: session } = authClient.useSession()
  const { data, error, refetch } = useQuery(preferencesQuery())
  const capabilities = useQuery(capabilitiesQuery())
  const set = useSetPreference()
  // The row whose switch was flipped last: its "Saved" note sits beside the switch.
  const [last, setLast] = useState<keyof Inbox.Preferences | null>(null)
  // Email notifications need the server to send mail (SMTP).
  const mailConfigured = capabilities.data?.mailConfigured === true
  // The installed app is a notifier first: push leads the page there.
  const installed = usePwaStore((s) => s.installed)

  return (
    <Frame
      crumbs={['Account', 'Notifications']}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {data ? (
        <>
          {installed ? <PushSection preferences={data} /> : null}
          <SettingsSection
            title="Email"
            description="Only the two things that need you soon can be emailed."
            bare={!mailConfigured}
          >
            {mailConfigured ? (
              PREFERENCE_ROWS.map((row) => (
                <SettingsRow key={row.key} label={row.label} detail={row.description}>
                  <span className={styles.control}>
                    {last === row.key ? <SaveNote mutation={set} /> : null}
                    <Switch
                      label={<span style={visuallyHidden}>Email: {row.label}</span>}
                      checked={data[row.key]}
                      onCheckedChange={(on) => {
                        setLast(row.key)
                        set.mutate(
                          { [row.key]: on },
                          { onSuccess: () => toast(`${row.label} ${on ? 'on' : 'off'}, saved`) },
                        )
                      }}
                    />
                  </span>
                </SettingsRow>
              ))
            ) : (
              <Banner>
                This server can't send mail yet, so there are no email notifications to switch on.
                Ask an admin to set up outgoing mail.
              </Banner>
            )}
          </SettingsSection>
          {mailConfigured && session ? (
            <Text variant="small" tone="tertiary">
              Mail goes to {session.user.email}.
            </Text>
          ) : null}

          {installed ? null : <PushSection preferences={data} />}

          <SettingsSection
            title="In your Inbox"
            description="Always on. Snooze or delete single items from the Inbox instead."
          >
            {IN_INBOX.map((n) => (
              <SettingsRow key={n.title} label={n.title} detail={n.help} />
            ))}
          </SettingsSection>

          <SettingsSection title="Project channels" bare>
            <Banner>
              Slack channels for a project are set by an admin in workspace integrations, not here.
            </Banner>
          </SettingsSection>
        </>
      ) : null}
    </Frame>
  )
}
