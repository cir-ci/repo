import type { InstanceAdmin } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  NumberField,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { toast } from '#lib/toast.ts'

import { AdminFrame } from './AdminFrame.tsx'
import {
  settingsQuery,
  useRemoveInstanceConfig,
  useSaveInstanceConfig,
  useSendTestMail,
} from './api/admin.ts'
import {
  type ConfigDraft,
  configProblems,
  draftOf,
  isDirty,
  limitBounds,
  lockedBy,
  mailServer,
  noSignInLeft,
  saveRequests,
} from './config-model.ts'
import { GithubAppSection } from './GithubAppSection.tsx'
import { SecretField } from './SecretField.tsx'
import { SsoProvidersSection } from './SsoProvidersSection.tsx'

import styles from './Admin.module.css'

/** One read-only row: the value, what it means, and the variable that sets it. */
function Setting(props: { title: ReactNode; note?: ReactNode; env: string; children?: ReactNode }) {
  return (
    <SettingsRow label={props.title} detail={props.note} env={props.env}>
      {props.children}
    </SettingsRow>
  )
}

/**
 * The instance's settings: what an instance admin can change here (sign-in methods, who creates
 * workspaces, the mail server, the Slack app, limits, single sign-on providers) and what only the
 * server's environment sets. A variable that is set wins and locks its setting ("Set by …").
 */
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
      {data ? (
        // Keyed by what is saved, so a save (or a change elsewhere) resets the draft.
        <SettingsForm key={JSON.stringify(data.config)} settings={data} />
      ) : null}
      <GithubAppSection result={search.githubApp} />
    </AdminFrame>
  )
}

function SettingsForm({ settings }: { settings: InstanceAdmin.Settings }) {
  const { config } = settings
  const save = useSaveInstanceConfig()
  const [draft, setDraft] = useState<ConfigDraft>(() => draftOf(config))
  const [shown, setShown] = useState(false)
  const problems = configProblems(config, draft)
  const dirty = isDirty(config, draft)

  const update = (change: (d: ConfigDraft) => ConfigDraft) => {
    setDraft(change(draft))
    if (save.isError) save.reset()
  }

  function submit() {
    setShown(true)
    if (!dirty || Object.keys(problems).length > 0) return
    save.mutate(saveRequests(config, draft))
  }

  return (
    <div className={styles.page}>
      <AddressSection settings={settings} />
      <SignInSection config={config} draft={draft} update={update} disabled={save.isPending} />
      <SsoProvidersSection providers={config.sso} origin={settings.publicUrl} />
      <CreationSection config={config} draft={draft} update={update} disabled={save.isPending} />
      <MailSection
        config={config}
        draft={draft}
        update={update}
        problems={shown ? problems : {}}
        disabled={save.isPending}
      />
      <SlackSection
        config={config}
        draft={draft}
        update={update}
        problems={shown ? problems : {}}
        disabled={save.isPending}
      />
      <LimitsSection
        settings={settings}
        draft={draft}
        update={update}
        problems={shown ? problems : {}}
        disabled={save.isPending}
      />
      <div className={styles.footer} data-save-bar="" data-clean={dirty ? undefined : ''}>
        <Button
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setDraft(draftOf(config))
            setShown(false)
            save.reset()
          }}
        >
          Discard
        </Button>
        <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={submit}>
          Save changes
        </Button>
      </div>
    </div>
  )
}

interface PartProps {
  config: InstanceAdmin.Config
  draft: ConfigDraft
  update: (change: (d: ConfigDraft) => ConfigDraft) => void
  disabled: boolean
}

type Problems = Record<string, string>

function AddressSection({ settings }: { settings: InstanceAdmin.Settings }) {
  return (
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
  )
}

function SignInSection({ config, draft, update, disabled }: PartProps) {
  const row = (
    key: keyof ConfigDraft['signIn'],
    label: string,
    description: string,
    field: InstanceAdmin.Field<boolean>,
  ) => (
    <SettingsRow env={lockedBy(field)}>
      <Checkbox
        label={label}
        description={description}
        checked={draft.signIn[key]}
        disabled={disabled || field.source === 'env'}
        onCheckedChange={(on) => update((d) => ({ ...d, signIn: { ...d.signIn, [key]: on } }))}
      />
    </SettingsRow>
  )
  return (
    <SettingsSection
      title="Sign-in methods allowed on this instance"
      description="The outer limit. Each workspace can turn methods off for its own people, never on beyond this."
    >
      {row('password', 'Password', 'Email and password.', config.signIn.password)}
      {row(
        'email',
        'Email code',
        'A code mailed to the address. It needs a mail server.',
        config.signIn.email,
      )}
      {row(
        'sso',
        'Single sign-on',
        config.sso.length === 0
          ? 'No provider is set up yet: add one below for it to work.'
          : 'The providers below.',
        config.signIn.sso,
      )}
      {noSignInLeft(config, draft) ? (
        <Banner tone="warning">
          No sign-in method would be left, so nobody could sign in, you included.
        </Banner>
      ) : null}
    </SettingsSection>
  )
}

function CreationSection({ config, draft, update, disabled }: PartProps) {
  const field = config.workspaceCreation
  return (
    <SettingsSection title="Who can create workspaces">
      <SettingsRow env={lockedBy(field)}>
        <Checkbox
          label="Let every signed-in account create workspaces"
          description="Otherwise only instance admins can. Everyone else joins through an invitation or a verified email domain."
          checked={draft.anyoneCreatesWorkspaces}
          disabled={disabled || field.source === 'env'}
          onCheckedChange={(on) => update((d) => ({ ...d, anyoneCreatesWorkspaces: on }))}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function MailSection({
  config,
  draft,
  update,
  problems,
  disabled,
}: PartProps & { problems: Problems }) {
  const test = useSendTestMail()
  const remove = useRemoveInstanceConfig('smtp')
  const [confirming, setConfirming] = useState(false)
  const { smtp } = config
  const locked = smtp.source === 'env'
  const off = disabled || locked
  const set = (change: Partial<ConfigDraft['smtp']>) =>
    update((d) => ({ ...d, smtp: { ...d.smtp, ...change } }))
  const changed =
    isDirty(config, draft) && saveRequests(config, draft).some((r) => r.path[1] === 'smtp')

  return (
    <SettingsSection title="Mail server">
      {locked ? (
        <Setting
          title={<Text variant="mono">{mailServer(smtp)}</Text>}
          note={`Sends as ${smtp.from}${smtp.passwordSaved ? ', signing in with a username and password' : ''}.`}
          env={`Set by ${smtp.env}`}
        />
      ) : (
        <SettingsRow>
          <div className={styles.fields}>
            <TextField
              label="Host"
              value={draft.smtp.host}
              placeholder="smtp.acme.io"
              disabled={off}
              error={problems['smtp.host']}
              onChange={(e) => set({ host: e.target.value })}
            />
            <NumberField
              label="Port"
              value={draft.smtp.port}
              min={1}
              max={65_535}
              disabled={off}
              error={problems['smtp.port']}
              onValueChange={(port) => set({ port })}
            />
            <Checkbox
              label="Use TLS from the start"
              description="Normally for port 465. Otherwise the connection upgrades to TLS when the server offers it."
              checked={draft.smtp.secure}
              disabled={off}
              onCheckedChange={(secure) => set({ secure })}
            />
            <TextField
              label="User name"
              value={draft.smtp.user}
              autoComplete="off"
              disabled={off}
              error={problems['smtp.user']}
              onChange={(e) => set({ user: e.target.value })}
            />
            <SecretField
              label="Password"
              saved={smtp.passwordSaved}
              draft={draft.smtp.password}
              disabled={off}
              error={problems['smtp.password']}
              onChange={(password) => set({ password })}
            />
            <TextField
              label="From address"
              value={draft.smtp.from}
              placeholder="CirCI <ci@acme.io>"
              disabled={off}
              error={problems['smtp.from']}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
        </SettingsRow>
      )}
      <SettingsRow
        label="Send a test mail to your own address"
        detail={changed ? 'It uses the saved settings: save your changes first.' : undefined}
      >
        <div className={styles.rowActions}>
          <Button
            loading={test.isPending}
            disabled={changed}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: (r) => (r.ok ? toast(r.message) : toast.error(r.message)),
              })
            }
          >
            Send test mail
          </Button>
          {smtp.source === 'stored' ? (
            <Button variant="ghost" disabled={disabled} onClick={() => setConfirming(true)}>
              Remove mail server
            </Button>
          ) : null}
        </div>
      </SettingsRow>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove the mail server?"
        description="Nobody gets sign-in codes or invitations by email until another one is set up."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => toast('Removed the mail server'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </SettingsSection>
  )
}

function SlackSection({
  config,
  draft,
  update,
  problems,
  disabled,
}: PartProps & { problems: Problems }) {
  const remove = useRemoveInstanceConfig('slack')
  const [confirming, setConfirming] = useState(false)
  const { slack } = config
  const locked = slack.source === 'env'
  const set = (change: Partial<ConfigDraft['slack']>) =>
    update((d) => ({ ...d, slack: { ...d.slack, ...change } }))
  return (
    <SettingsSection
      title="Slack app"
      description="Workspaces connect Slack through this app. Create one at api.slack.com/apps and set its redirect address to this dashboard."
    >
      {locked ? (
        <Setting
          title={<Text variant="mono">{slack.clientId}</Text>}
          note="Client ID"
          env={`Set by ${slack.env}`}
        />
      ) : (
        <SettingsRow>
          <div className={styles.fields}>
            <TextField
              label="Client ID"
              value={draft.slack.clientId}
              disabled={disabled}
              error={problems['slack.clientId']}
              onChange={(e) => set({ clientId: e.target.value })}
            />
            <SecretField
              label="Client secret"
              saved={slack.secretSaved}
              draft={draft.slack.secret}
              disabled={disabled}
              error={problems['slack.secret']}
              removable={false}
              onChange={(secret) => set({ secret })}
            />
          </div>
        </SettingsRow>
      )}
      {slack.source === 'stored' ? (
        <SettingsRow label="Remove the Slack app">
          <Button variant="ghost" disabled={disabled} onClick={() => setConfirming(true)}>
            Remove Slack app
          </Button>
        </SettingsRow>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove the Slack app?"
        description="Workspaces can't add Slack until one is set up again. Connections they already made stop working."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => toast('Removed the Slack app'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </SettingsSection>
  )
}

const LIMIT_TEXT: Record<
  keyof ConfigDraft['limits'],
  { label: string; unit: string; note?: string }
> = {
  defaultProjectRetentionDays: {
    label: 'New projects keep builds for',
    unit: 'days',
    note: 'Each project can change this in its own settings.',
  },
  gcGraceHours: { label: 'Unused files are deleted after', unit: 'hours' },
  uploadTimeoutMinutes: {
    label: 'A build still uploading fails after',
    unit: 'minutes',
    note: '0 never times out.',
  },
  jobRetentionDays: {
    label: 'Finished background jobs are kept for',
    unit: 'days',
    note: '0 keeps them.',
  },
  staticSitesMaxMb: { label: 'Largest hosted site', unit: 'MB' },
  webhookTimeoutSeconds: { label: 'A webhook receiver may take up to', unit: 'seconds' },
}

function LimitRow({
  name,
  config,
  draft,
  update,
  problems,
  disabled,
}: PartProps & { name: keyof ConfigDraft['limits']; problems: Problems }) {
  const text = LIMIT_TEXT[name]
  const field = config.limits[name]
  const bounds = limitBounds(name)
  const locked = field.source === 'env'
  return (
    <SettingsRow env={lockedBy(field)}>
      <NumberField
        label={text.label}
        unit={text.unit}
        value={draft.limits[name]}
        min={bounds.min}
        max={bounds.max}
        step={bounds.integer ? 1 : 0.5}
        disabled={disabled || locked}
        error={problems[`limits.${name}`]}
        description={text.note}
        onValueChange={(value) => update((d) => ({ ...d, limits: { ...d.limits, [name]: value } }))}
      />
    </SettingsRow>
  )
}

function LimitsSection(
  props: Omit<PartProps, 'config'> & { settings: InstanceAdmin.Settings; problems: Problems },
) {
  const { settings, ...rest } = props
  const part = { ...rest, config: settings.config }
  return (
    <>
      <SettingsSection title="Storage and limits">
        <Setting
          title={
            settings.storage.driver === 's3'
              ? `S3 bucket ${settings.storage.bucket ?? ''}`
              : 'Local disk'
          }
          env="STORAGE_DRIVER"
        />
        <LimitRow name="defaultProjectRetentionDays" {...part} />
        <LimitRow name="gcGraceHours" {...part} />
        <LimitRow name="uploadTimeoutMinutes" {...part} />
        <LimitRow name="jobRetentionDays" {...part} />
        <LimitRow name="webhookTimeoutSeconds" {...part} />
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
          <>
            <Setting
              title={<Text variant="mono">{settings.staticSites.host}</Text>}
              note="Projects switch hosting on in their own settings."
              env="STATIC_SITES_HOST"
            >
              <Link to="/instance/health" className={styles.env}>
                Check domain rules
              </Link>
            </Setting>
            <LimitRow name="staticSitesMaxMb" {...part} />
          </>
        ) : (
          <Setting
            title="Not set up"
            note="Projects can't host sites until a separate domain is configured."
            env="STATIC_SITES_HOST"
          />
        )}
      </SettingsSection>
    </>
  )
}
