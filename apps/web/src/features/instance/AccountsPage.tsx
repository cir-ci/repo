import type { InstanceAdmin } from '@circi/api'
import {
  AddCircleIcon,
  Avatar,
  Badge,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  NumberField,
  IconButton,
  ListRow,
  Menu,
  RowMenuIcon,
  SearchIcon,
  SegmentedControl,
  SettingsSection,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'

import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { numberOf, textOf } from '#lib/number-field.ts'

import { AdminFrame, Intro } from './AdminFrame.tsx'
import {
  type AccountDraft,
  accountProblems,
  accountsQuery,
  type BanDraft,
  banProblem,
  banSummary,
  emptyAccountDraft,
  lastSeen,
  PAGE_SIZE,
  pageCount,
  useBanAccount,
  useCreateAccount,
  useResetPassword,
  useSetInstanceAdmin,
  useSignOutEverywhere,
  useUnbanAccount,
} from './api/admin.ts'
import { OnceSecret } from './OnceSecret.tsx'

import styles from './Admin.module.css'

/** What the admin asked to do to an account, waiting for the confirmation. */
type Pending = {
  kind: 'reset' | 'admin' | 'sign-out' | 'unban' | 'ban'
  account: InstanceAdmin.Account
} | null

/** Accounts of the whole instance: search, page, create, and the actions on each one. */
export function AccountsPage() {
  useDocumentTitle('Accounts', 'Instance')
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const { data, error, refetch, isFetching } = useQuery(accountsQuery({ q, page }))
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Typing searches after a short pause, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed)
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [typed])

  const [now] = useState(() => Date.now())
  const pages = data ? pageCount(data.total, data.pageSize) : 1

  return (
    <AdminFrame
      title="Accounts"
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
    >
      <Intro
        action={
          <Button
            variant="primary"
            leading={<AddCircleIcon />}
            onClick={() => {
              setDone(null)
              setCreating(true)
            }}
          >
            Create account
          </Button>
        }
      >
        Everyone who can sign in to this CirCI. Nobody can sign themselves up: accounts come from
        here, from invitations and from verified email domains.
      </Intro>
      {failure ? <Banner tone="danger">{failure}</Banner> : null}
      {done ? <Banner tone="success">{done}</Banner> : null}
      <SettingsSection
        title="All accounts"
        bare
        description={
          data ? `${data.total} ${data.total === 1 ? 'account' : 'accounts'}` : undefined
        }
        actions={
          <TextField
            className={styles.search}
            label="Search accounts"
            placeholder="Search by name or email"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        }
      >
        <div className={styles.box}>
          {data && data.accounts.length === 0 ? (
            <EmptyState icon={<SearchIcon size={32} />} title="No accounts found">
              {q ? `Nothing matches “${q}”.` : 'There are no accounts yet.'}
            </EmptyState>
          ) : (
            <ul className={styles.list} aria-label="Accounts" aria-busy={isFetching}>
              {data?.accounts.map((account) => (
                <li key={account.id}>
                  <AccountRow
                    account={account}
                    now={now}
                    onAction={(kind) => {
                      setFailure(null)
                      setDone(null)
                      setPending({ kind, account })
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        {data && pages > 1 ? (
          <nav className={styles.pager} aria-label="Pages">
            <Text tone="secondary">
              Page {data.page} of {pages}
            </Text>
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </nav>
        ) : null}
        <Text tone="tertiary" variant="small">
          Banning signs the person out at once and keeps their reviews in each build’s history. The
          same actions are in <code>circi admin user</code> on the server. Up to {PAGE_SIZE}{' '}
          accounts per page.
        </Text>
      </SettingsSection>

      <CreateAccountDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(email, password, codeSent) => {
          setCreating(false)
          if (password) setSecret({ email, password })
          else if (codeSent) setDone(`Created the account for ${email} and emailed a sign-in code.`)
          else setDone(`Created the account for ${email}.`)
        }}
      />
      <AccountActions
        pending={pending}
        onClose={() => setPending(null)}
        onFailed={(message) => setFailure(message)}
        onDone={(message) => setDone(message)}
        onSecret={(email, password) => setSecret({ email, password })}
      />
      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) setSecret(null)
        }}
        title="Password created"
        description="Pass it on yourself: CirCI does not keep it in a form anyone can read."
        dismissible={false}
        actions={
          <Button variant="primary" onClick={() => setSecret(null)}>
            Done
          </Button>
        }
      >
        {secret ? <OnceSecret email={secret.email} password={secret.password} /> : null}
      </Dialog>
    </AdminFrame>
  )
}

function AccountRow(props: {
  account: InstanceAdmin.Account
  now: number
  onAction: (kind: 'reset' | 'admin' | 'sign-out' | 'unban' | 'ban') => void
}) {
  const { account } = props
  const ban = banSummary(account)
  return (
    <ListRow
      density="two-line"
      leading={<Avatar name={account.name} size={28} />}
      trailing={
        <>
          <Text className={styles.workspacesCol} tone="tertiary" variant="small">
            {account.workspaceCount === 0
              ? 'No workspace'
              : `${account.workspaceCount} ${account.workspaceCount === 1 ? 'workspace' : 'workspaces'}`}
          </Text>
          <Text className={styles.when} tone="tertiary" variant="small">
            {lastSeen(account, props.now)}
          </Text>
          <Menu
            align="end"
            trigger={
              <IconButton label={`Actions for ${account.name}`}>
                <RowMenuIcon />
              </IconButton>
            }
            items={[
              { label: 'Reset password', onSelect: () => props.onAction('reset') },
              {
                label: account.instanceAdmin ? 'Remove instance admin' : 'Make instance admin',
                onSelect: () => props.onAction('admin'),
              },
              { label: 'Sign out everywhere', onSelect: () => props.onAction('sign-out') },
              { type: 'separator' },
              account.banned
                ? { label: 'Lift ban', onSelect: () => props.onAction('unban') }
                : { label: 'Ban', tone: 'danger', onSelect: () => props.onAction('ban') },
            ]}
          />
        </>
      }
    >
      <div className={styles.identity}>
        <span>
          <Text>{account.name}</Text>{' '}
          {account.instanceAdmin ? (
            <Badge shape="tag" tone="accent">
              Instance admin
            </Badge>
          ) : null}{' '}
          {account.banned ? (
            <Badge shape="tag" tone="state" state="rejected">
              Banned
            </Badge>
          ) : null}
        </span>
        <Text tone="tertiary" variant="small">
          {account.email}
        </Text>
        {ban ? (
          <Text tone="rejected" variant="small">
            {ban}
          </Text>
        ) : null}
      </div>
    </ListRow>
  )
}

function CreateAccountDialog(props: {
  open: boolean
  onClose: () => void
  onCreated: (email: string, password: string | null, codeSent: boolean) => void
}) {
  const create = useCreateAccount()
  // Sending a sign-in code needs mail; without it only the password choice is offered.
  const { data: caps } = useQuery(capabilitiesQuery())
  const mailConfigured = caps?.mailConfigured === true
  const [draft, setDraft] = useState<AccountDraft>(emptyAccountDraft)
  const [shown, setShown] = useState(false)
  const problems = accountProblems(draft)
  const show = (key: keyof AccountDraft) => (shown ? problems[key] : undefined)

  function close() {
    setDraft(emptyAccountDraft())
    setShown(false)
    create.reset()
    props.onClose()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setShown(true)
    if (Object.keys(problems).length > 0) return
    create.mutate(draft, {
      onSuccess: (created) => {
        const email = created.account.email
        setDraft(emptyAccountDraft())
        setShown(false)
        props.onCreated(email, created.password, created.signInCodeSentTo !== undefined)
      },
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title="Create account"
      description={
        draft.delivery === 'code'
          ? 'No password is set. CirCI mails them a one-time sign-in code and link.'
          : 'CirCI generates a password and shows it to you once, or you can choose one.'
      }
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="create-account" variant="primary" loading={create.isPending}>
            Create account
          </Button>
        </>
      }
    >
      <form id="create-account" onSubmit={submit} noValidate className={styles.fields}>
        <TextField
          label="Name"
          value={draft.name}
          error={show('name')}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoComplete="off"
        />
        <TextField
          label="Email"
          type="email"
          value={draft.email}
          error={show('email')}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          autoComplete="off"
        />
        {mailConfigured ? (
          <SegmentedControl
            label="How they first sign in"
            value={draft.delivery}
            options={[
              { value: 'password', label: 'Show a generated password' },
              { value: 'code', label: 'Email a sign-in code' },
            ]}
            onChange={(value) =>
              setDraft({ ...draft, delivery: value === 'code' ? 'code' : 'password' })
            }
          />
        ) : null}
        {draft.delivery === 'password' ? (
          <TextField
            label="Password (leave empty to generate one)"
            type="password"
            value={draft.password}
            error={show('password')}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            autoComplete="new-password"
          />
        ) : null}
        <Checkbox
          label="Make them an instance admin"
          checked={draft.instanceAdmin}
          onCheckedChange={(checked) => setDraft({ ...draft, instanceAdmin: checked })}
        />
        {create.error ? <Banner tone="danger">{create.error.message}</Banner> : null}
      </form>
    </Dialog>
  )
}

/** The confirmation for whichever action is pending, and the call it makes. */
function AccountActions(props: {
  pending: Pending
  onClose: () => void
  onFailed: (message: string) => void
  onDone: (message: string) => void
  onSecret: (email: string, password: string) => void
}) {
  const reset = useResetPassword()
  const setAdmin = useSetInstanceAdmin()
  const signOut = useSignOutEverywhere()
  const unban = useUnbanAccount()
  const ban = useBanAccount()
  const [banDraft, setBanDraft] = useState<BanDraft>({ reason: '', days: '' })
  const { pending, onClose, onFailed, onDone } = props
  const account = pending?.account
  const busy =
    reset.isPending || setAdmin.isPending || signOut.isPending || unban.isPending || ban.isPending

  const fail = (err: Error) => {
    onClose()
    onFailed(err.message)
  }
  const finish = (message: string) => {
    onClose()
    onDone(message)
  }

  function confirm() {
    if (!pending || !account) return
    switch (pending.kind) {
      case 'reset':
        reset.mutate(account.id, {
          onSuccess: ({ password }) => {
            onClose()
            props.onSecret(account.email, password)
          },
          onError: fail,
        })
        break
      case 'admin':
        setAdmin.mutate(
          { id: account.id, instanceAdmin: !account.instanceAdmin },
          {
            onSuccess: () =>
              finish(
                account.instanceAdmin
                  ? `${account.name} is no longer an instance admin.`
                  : `${account.name} is now an instance admin.`,
              ),
            onError: fail,
          },
        )
        break
      case 'sign-out':
        signOut.mutate(account.id, {
          onSuccess: () => finish(`${account.name} was signed out everywhere.`),
          onError: fail,
        })
        break
      case 'unban':
        unban.mutate(account.id, {
          onSuccess: () => finish(`Lifted the ban on ${account.name}.`),
          onError: fail,
        })
        break
      case 'ban':
        break
    }
  }

  function submitBan(e: FormEvent) {
    e.preventDefault()
    if (!account || banProblem(banDraft)) return
    ban.mutate(
      { id: account.id, draft: banDraft },
      {
        onSuccess: () => {
          setBanDraft({ reason: '', days: '' })
          finish(`${account.name} is banned and signed out.`)
        },
        onError: fail,
      },
    )
  }

  const kind = pending?.kind
  const name = account?.name ?? ''
  const copy = {
    reset: {
      title: `Reset the password for ${name}?`,
      description:
        'They are signed out everywhere. You’ll see the new password only once, so pass it on to them yourself.',
      label: 'Reset password',
    },
    admin: account?.instanceAdmin
      ? {
          title: `Remove ${name} as instance admin?`,
          description:
            'They lose access to the Instance pages. The last instance admin can’t be removed; make someone else an instance admin first.',
          label: 'Remove instance admin',
        }
      : {
          title: `Make ${name} an instance admin?`,
          description:
            'They can see every account and workspace name, create workspaces and read the instance health.',
          label: 'Make instance admin',
        },
    'sign-out': {
      title: `Sign ${name} out everywhere?`,
      description: 'Every session of this account ends. They can sign in again.',
      label: 'Sign out everywhere',
    },
    unban: {
      title: `Lift the ban on ${name}?`,
      description: 'They can sign in again.',
      label: 'Lift ban',
    },
    ban: { title: '', description: '', label: '' },
  }[kind ?? 'ban']

  return (
    <>
      <ConfirmDialog
        open={kind !== undefined && kind !== 'ban'}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.label}
        loading={busy}
        onConfirm={confirm}
      />
      <Dialog
        open={kind === 'ban'}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={`Ban ${name}?`}
        description="They are signed out at once and cannot sign in until the ban is lifted. Their reviews stay in each build’s history."
        actions={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form="ban-account" variant="danger" loading={ban.isPending}>
              Ban
            </Button>
          </>
        }
      >
        <form id="ban-account" onSubmit={submitBan} noValidate className={styles.fields}>
          <TextField
            label="Reason (optional)"
            value={banDraft.reason}
            maxLength={500}
            onChange={(e) => setBanDraft({ ...banDraft, reason: e.target.value })}
            autoComplete="off"
          />
          <NumberField
            label="Days until the ban ends (leave empty for no end)"
            unit="days"
            step={1}
            value={numberOf(banDraft.days)}
            error={banProblem(banDraft) ?? undefined}
            onValueChange={(next) => setBanDraft({ ...banDraft, days: textOf(next) })}
          />
        </form>
      </Dialog>
    </>
  )
}
