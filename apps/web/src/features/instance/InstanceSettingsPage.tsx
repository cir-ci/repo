import type { InstanceAdmin } from '@circi/api'
import { Badge, Banner, Button, SettingsRow, SettingsSection, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { toast } from '#lib/toast.ts'

import { AdminFrame } from './AdminFrame.tsx'
import { mailServer, settingsQuery, signInMethods, useSendTestMail } from './api/admin.ts'
import { GithubAppSection } from './GithubAppSection.tsx'

import styles from './Admin.module.css'

/** One read-only row: the value, what it means, and the variable that sets it. */
function Setting(props: { title: ReactNode; note?: ReactNode; env: string; children?: ReactNode }) {
  return (
    <SettingsRow label={props.title} detail={props.note} env={props.env}>
      {props.children}
    </SettingsRow>
  )
}

/** The effective settings from the server's environment (read-only), the mail test, the GitHub App. */
export function InstanceSettingsPage() {
  useDocumentTitle('Instance settings')
  const search: { githubApp?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(settingsQuery())

  return (
    <AdminFrame
      title="Instance settings"
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      {data ? <Sections settings={data} /> : null}
      <GithubAppSection result={search.githubApp} />
    </AdminFrame>
  )
}

function Sections({ settings }: { settings: InstanceAdmin.Settings }) {
  const { retention } = settings
  return (
    <>
      <SettingsSection
        title="Dashboard address"
        description="Every link CirCI sends out uses it: pull request comments, checks, emails, the GitHub App's webhook."
      >
        <Setting title={<Text variant="mono">{settings.publicUrl}</Text>} env="PUBLIC_URL" />
        <Setting
          title="Old addresses that redirect here"
          env="PREVIOUS_PUBLIC_URLS"
          note={
            settings.previousPublicHosts.length > 0
              ? `${settings.previousPublicHosts.join(', ')} answer with a redirect to the same page here, so old links keep working.`
              : 'None. No old address redirects here.'
          }
        >
          <Link to="/instance/health" className={styles.env}>
            See the move checklist
          </Link>
        </Setting>
      </SettingsSection>

      <SettingsSection
        title="Sign-in methods allowed on this instance"
        description="The outer limit. Each workspace can turn methods off for its own people, never on beyond this."
      >
        {signInMethods(settings.auth).map((m) => (
          <Setting key={m.key} title={m.name} note={m.description} env={m.env}>
            <Badge shape="tag" tone="state" state={m.allowed ? 'approved' : 'review'}>
              {m.allowed ? 'Allowed' : 'Off'}
            </Badge>
          </Setting>
        ))}
      </SettingsSection>

      <MailSection mail={settings.mail} />

      <SettingsSection title="Storage and limits">
        <Setting
          title={
            settings.storage.driver === 's3'
              ? `S3 bucket ${settings.storage.bucket ?? ''}`
              : 'Local disk'
          }
          env="STORAGE_DRIVER"
        />
        <Setting
          title={`New teams keep builds for ${retention.defaultTeamRetentionDays} days`}
          note="Each team can change this in its own settings."
          env="DEFAULT_TEAM_RETENTION_DAYS"
        />
        <Setting
          title={`Unused files are deleted after ${retention.gcGraceHours} hours`}
          env="GC_GRACE_HOURS"
        />
        <Setting
          title={
            retention.uploadTimeoutMinutes === 0
              ? 'A build that is still uploading never times out'
              : `A build still uploading after ${retention.uploadTimeoutMinutes} minutes fails`
          }
          env="UPLOAD_TIMEOUT_MINUTES"
        />
        <Setting
          title={
            settings.webhooksAllowPrivateAddresses
              ? 'Webhooks may call private addresses'
              : 'Webhooks may not call private addresses'
          }
          env="WEBHOOK_ALLOW_PRIVATE_ADDRESSES"
        />
      </SettingsSection>

      <SettingsSection
        title="Hosted sites"
        description="Storybooks and reports are served from their own domain so their code can never touch your sign-in cookies."
      >
        {settings.staticSites ? (
          <Setting
            title={<Text variant="mono">{settings.staticSites.host}</Text>}
            note={`Largest site ${settings.staticSites.maxMb} MB. Teams switch hosting on in their own settings.`}
            env="STATIC_SITES_HOST, STATIC_SITES_MAX_MB"
          >
            <Link to="/instance/health" className={styles.env}>
              Check domain rules
            </Link>
          </Setting>
        ) : (
          <Setting
            title="Not set up"
            note="Teams can't host sites until a separate domain is configured."
            env="STATIC_SITES_HOST"
          />
        )}
      </SettingsSection>
    </>
  )
}

function MailSection({ mail }: { mail: InstanceAdmin.Settings['mail'] }) {
  const test = useSendTestMail()
  const result = test.data
  return (
    <>
      <SettingsSection title="Mail">
        {mail.configured ? (
          <>
            <Setting
              title={<Text variant="mono">{mailServer(mail)}</Text>}
              note={
                mail.authenticated
                  ? 'Signs in with a username and password.'
                  : 'Sends without signing in.'
              }
              env="SMTP_HOST, SMTP_PORT, SMTP_SECURE"
            />
            <Setting
              title={<Text variant="mono">{mail.from}</Text>}
              note="Sends as"
              env="SMTP_FROM"
            />
          </>
        ) : (
          <Setting
            title="Mail isn't configured"
            note="Without it, nobody gets sign-in codes or invitations by email."
            env="SMTP_HOST, SMTP_FROM"
          />
        )}
        <SettingsRow label="Send a test mail to your own address">
          <Button
            loading={test.isPending}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: (r) => (r.ok ? toast(r.message) : toast.error(r.message)),
              })
            }
          >
            Send test mail
          </Button>
        </SettingsRow>
      </SettingsSection>
      {test.error ? <Banner tone="danger">{test.error.message}</Banner> : null}
      {result ? <Banner tone={result.ok ? 'success' : 'danger'}>{result.message}</Banner> : null}
    </>
  )
}
