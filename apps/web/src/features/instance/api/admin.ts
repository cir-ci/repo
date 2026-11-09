import type { InstanceAdmin } from '@circi/api'
import { slugify } from '@circi/core/slug'
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { instancePath } from '#lib/api-paths.ts'
import { getJson, HttpError, post, send } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import { formatRelative } from '#lib/relative-time.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

/** The server refuses shorter passwords (`MIN_PASSWORD_LENGTH` in `@circi/auth`). */
export const MIN_PASSWORD_LENGTH = 12
export const PAGE_SIZE = 25

/** The viewer is signed in but is not an instance admin: the server answers 403. */
export const isForbidden = (error: Error | null | undefined) =>
  error instanceof HttpError && error.status === 403

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What a person fills in to create an account. */
export interface AccountDraft {
  name: string
  email: string
  instanceAdmin: boolean
  /** Empty: CirCI generates one and shows it once. */
  password: string
  /** `password`: a password is shown once. `code`: no password; a sign-in code is mailed. */
  delivery: 'password' | 'code'
}

export const emptyAccountDraft = (): AccountDraft => ({
  name: '',
  email: '',
  instanceAdmin: false,
  password: '',
  delivery: 'password',
})

/** What is wrong with each field of an account, by field; empty when it can be created. */
export function accountProblems(draft: AccountDraft): Partial<Record<keyof AccountDraft, string>> {
  const problems: Partial<Record<keyof AccountDraft, string>> = {}
  if (!draft.name.trim()) problems.name = 'Enter a name'
  if (!EMAIL.test(draft.email.trim())) problems.email = 'Enter a valid email address'
  if (
    draft.delivery === 'password' &&
    draft.password &&
    draft.password.length < MIN_PASSWORD_LENGTH
  )
    problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters, or leave it empty`
  return problems
}

/** The request body for `POST /api/instance/accounts`. */
export const accountBody = (draft: AccountDraft) => ({
  name: draft.name.trim(),
  email: draft.email.trim(),
  ...(draft.instanceAdmin ? { instanceAdmin: true } : {}),
  ...(draft.delivery === 'code'
    ? { signInCode: true }
    : draft.password
      ? { password: draft.password }
      : {}),
})

/** What a person fills in to ban an account; `days` empty is permanent. */
export interface BanDraft {
  reason: string
  days: string
}

export function banProblem(draft: BanDraft): string | null {
  if (draft.days.trim() === '') return null
  const days = Number(draft.days)
  return Number.isInteger(days) && days >= 1 && days <= 3650
    ? null
    : 'Use a whole number of days from 1 to 3650, or leave it empty for no end'
}

/** The request body for `POST /api/instance/accounts/:id/ban`. */
export const banBody = (draft: BanDraft) => ({
  ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
  ...(draft.days.trim() ? { expiresInDays: Number(draft.days) } : {}),
})

const DATE = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "Sep 12, 2026" (UTC, so every viewer reads the same day). */
export const formatDay = (iso: string) => DATE.format(new Date(iso))

/** When the account last signed in, or a plain word for never. */
export function lastSeen(account: Pick<InstanceAdmin.Account, 'lastSignInAt'>, now: number) {
  return account.lastSignInAt ? formatRelative(account.lastSignInAt, now) : 'Never signed in'
}

/** The ban in a sentence: "Banned until Oct 3, 2026: reason". */
export function banSummary(
  account: Pick<InstanceAdmin.Account, 'banned' | 'banReason' | 'banExpires'>,
): string | null {
  if (!account.banned) return null
  const until = account.banExpires ? `Banned until ${formatDay(account.banExpires)}` : 'Banned'
  return account.banReason ? `${until}: ${account.banReason}` : until
}

export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize))

/** The address a workspace name becomes ("Acme Mobile" is "acme-mobile"). */
export const slugPreview = (name: string) => slugify(name)

export interface WorkspaceDraft {
  name: string
  ownerEmail: string
}

export function workspaceProblems(
  draft: WorkspaceDraft,
): Partial<Record<keyof WorkspaceDraft, string>> {
  const problems: Partial<Record<keyof WorkspaceDraft, string>> = {}
  if (!draft.name.trim()) problems.name = 'Enter a name'
  else if (!slugPreview(draft.name)) problems.name = 'Use at least one letter or digit'
  if (!EMAIL.test(draft.ownerEmail.trim())) problems.ownerEmail = 'Enter a valid email address'
  return problems
}

export const workspaceBody = (draft: WorkspaceDraft) => ({
  name: draft.name.trim(),
  ownerEmail: draft.ownerEmail.trim(),
})

/** One row of the sign-in methods list. */
export interface MethodRow {
  key: string
  name: string
  description: string
  env: string
  allowed: boolean
}

/** The sign-in methods the instance allows, each with the variable that controls it. */
export function signInMethods(auth: InstanceAdmin.Settings['auth']): MethodRow[] {
  return [
    {
      key: 'password',
      name: 'Password',
      description: 'Email and password.',
      env: 'AUTH_PASSWORD_ENABLED',
      allowed: auth.password,
    },
    {
      key: 'email',
      name: 'Email code',
      description: 'A code mailed to the address.',
      env: 'AUTH_EMAIL_ENABLED',
      allowed: auth.email,
    },
    ...auth.sso.map((p) => ({
      key: `sso-${p.id}`,
      name: p.name,
      description: 'Single sign-on for the whole instance.',
      env: `AUTH_${p.id.toUpperCase()}_*`,
      allowed: true,
    })),
  ]
}

/** "smtp.acme.io:587 (TLS)", or null without SMTP. */
export function mailServer(mail: InstanceAdmin.Settings['mail']): string | null {
  if (!mail.host) return null
  const port = mail.port ? `:${mail.port}` : ''
  return `${mail.host}${port}${mail.secure ? ' (TLS)' : ''}`
}

export const WORKSPACE_CREATION_TEXT: Record<InstanceAdmin.Settings['workspaceCreation'], string> =
  {
    admin: 'Instance admins only',
    anyone: 'Every signed-in account',
  }

/** How serious a doctor finding is, as a word and a badge state. */
export const FINDING_LEVEL: Record<
  InstanceAdmin.Finding['level'],
  { label: string; state: 'approved' | 'review' | 'processing' }
> = {
  ok: { label: 'Passing', state: 'approved' },
  warn: { label: 'Check', state: 'review' },
  info: { label: 'Note', state: 'processing' },
}

/** Warnings first, then notes, then what passes; the server's order within each. */
export function sortFindings(findings: InstanceAdmin.Finding[]): InstanceAdmin.Finding[] {
  const rank = { warn: 0, info: 1, ok: 2 } as const
  return findings
    .map((finding, index) => ({ finding, index }))
    .toSorted((a, b) => rank[a.finding.level] - rank[b.finding.level] || a.index - b.index)
    .map((x) => x.finding)
}

export function findingsSummary(findings: InstanceAdmin.Finding[]): string {
  const warned = findings.filter((f) => f.level === 'warn').length
  if (warned > 0) return `${warned} ${warned === 1 ? 'check needs' : 'checks need'} attention`
  return 'Everything passes'
}

export interface QueueTotals {
  pending: number
  running: number
  failed: number
  /** The oldest waiting job across queues; null with none waiting. */
  oldestPendingAt: string | null
  oldestQueue: string | null
}

export function queueTotals(queues: InstanceAdmin.QueueDepth[]): QueueTotals {
  let oldest: InstanceAdmin.QueueDepth | null = null
  for (const q of queues) {
    if (
      q.oldestPendingAt &&
      (!oldest?.oldestPendingAt || q.oldestPendingAt < oldest.oldestPendingAt)
    )
      oldest = q
  }
  return {
    pending: queues.reduce((n, q) => n + q.pending, 0),
    running: queues.reduce((n, q) => n + q.running, 0),
    failed: queues.reduce((n, q) => n + q.failed, 0),
    oldestPendingAt: oldest?.oldestPendingAt ?? null,
    oldestQueue: oldest?.queue ?? null,
  }
}

/** "42 seconds", "3 minutes", "2 hours": how long something has been waiting. */
export function formatAge(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  return `${Math.round(hours / 24)} days`
}

export { clipboard } from '#lib/use-copy.ts'

// ---- Server state -----------------------------------------------------------------------------

export interface AccountSearch {
  q: string
  page: number
}

export const accountsQuery = (search: AccountSearch) =>
  queryOptions({
    queryKey: keys.instanceAccounts(search),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(search.page), pageSize: String(PAGE_SIZE) })
      if (search.q.trim()) params.set('q', search.q.trim())
      return getJson<InstanceAdmin.AccountList>(`${instancePath('accounts')}?${params}`)
    },
    placeholderData: keepPreviousData,
  })

export const workspacesQuery = () =>
  queryOptions({
    queryKey: keys.instanceWorkspaces(),
    queryFn: () => getJson<InstanceAdmin.WorkspaceList>(instancePath('workspaces')),
  })

export const settingsQuery = () =>
  queryOptions({
    queryKey: keys.instanceSettings(),
    queryFn: () => getJson<InstanceAdmin.Settings>(instancePath('settings')),
  })

export const checksQuery = () =>
  queryOptions({
    queryKey: keys.instanceHealth('checks'),
    queryFn: () => getJson<InstanceAdmin.Checks>(instancePath('health', 'checks')),
    // The checks ask other hosts: a result stays until the admin asks again.
    staleTime: Infinity,
  })

export const checklistQuery = () =>
  queryOptions({
    queryKey: keys.instanceHealth('checklist'),
    queryFn: () =>
      getJson<InstanceAdmin.AddressChecklist>(instancePath('health', 'address-checklist')),
  })

export const queuesQuery = () =>
  queryOptions({
    queryKey: keys.instanceHealth('queues'),
    queryFn: () => getJson<InstanceAdmin.Queues>(instancePath('health', 'queues')),
  })

/** Every account list, whatever its search and page. */
const ACCOUNTS = keys.instanceAccounts()

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: AccountDraft) =>
      post<InstanceAdmin.CreatedAccount>(instancePath('accounts'), accountBody(draft)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS }),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      post<InstanceAdmin.PasswordReset>(instancePath('accounts', id, 'reset-password'), {}),
  })
}

export function useSetInstanceAdmin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; instanceAdmin: boolean }) =>
      send<unknown>('PATCH', instancePath('accounts', input.id), {
        instanceAdmin: input.instanceAdmin,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS }),
  })
}

export function useBanAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; draft: BanDraft }) =>
      post<unknown>(instancePath('accounts', input.id, 'ban'), banBody(input.draft)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS }),
  })
}

export function useUnbanAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<unknown>(instancePath('accounts', id, 'unban'), {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS }),
  })
}

export function useSignOutEverywhere() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<undefined>(instancePath('accounts', id, 'sign-out'), {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS }),
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: WorkspaceDraft) =>
      post<{ workspace: InstanceAdmin.Workspace }>(
        instancePath('workspaces'),
        workspaceBody(draft),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.instanceWorkspaces() }),
  })
}

/** What a deleted workspace's row says: it is purged when the days run out. */
export function deletedLabel(daysLeft: number | null): string {
  if (daysLeft === null) return ''
  if (daysLeft <= 0) return 'Deleted · being purged'
  return `Deleted · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
}

/** Brings a deleted workspace back with everything in it. */
export function useRestoreWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      post<{ workspace: InstanceAdmin.Workspace }>(instancePath('workspaces', id, 'restore'), {}),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.instanceWorkspaces(),
        keys.teams(),
        keys.sidebar(),
        keys.capabilities(),
      ),
  })
}

/** "Delete permanently now": only for a workspace that was already deleted. */
export function usePurgeWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<void>(instancePath('workspaces', id, 'purge'), {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.instanceWorkspaces() }),
  })
}

export function useSendTestMail() {
  return useMutation({
    mutationFn: () => post<InstanceAdmin.MailTest>(instancePath('mail', 'test'), {}),
  })
}
