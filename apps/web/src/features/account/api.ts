import type { Account, Inbox } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { getJson, send } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

import type { LinkedAccount } from './model.ts'

export const sessionsKey = keys.sessions()
export const accountsKey = keys.linkedAccounts()

export const sessionsQuery = () =>
  queryOptions({
    queryKey: sessionsKey,
    queryFn: async () => {
      const { data, error } = await authClient.listSessions()
      if (error || !data) throw new Error("Couldn't load your sessions")
      return data.toSorted((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    },
  })

export const accountsQuery = () =>
  queryOptions({
    queryKey: accountsKey,
    queryFn: async (): Promise<LinkedAccount[]> => {
      const { data, error } = await authClient.listAccounts()
      if (error || !data) throw new Error("Couldn't load your linked accounts")
      return data
    },
  })

// ---- Email preferences ------------------------------------------------------------------------

export const PREFERENCE_ROWS: readonly {
  key: keyof Inbox.Preferences
  label: string
  description: string
}[] = [
  {
    key: 'emailReviewRequested',
    label: 'Review requested',
    description: 'Email me when someone asks me to review a build.',
  },
  {
    key: 'emailReviewOverdue',
    label: 'Review overdue',
    description: 'Email me when a review I owe has waited past its target.',
  },
]

/** Which kinds go to the person's devices as web push (per person, for every device that is on). */
export const PUSH_ROWS: readonly {
  key: keyof Inbox.Preferences
  label: string
  description: string
}[] = [
  {
    key: 'pushReviewRequested',
    label: 'Review requested',
    description: 'Review requests, including again after a push, and overdue reviews.',
  },
  { key: 'pushMentioned', label: 'Mentioned', description: 'Someone @mentions you in a comment.' },
  {
    key: 'pushReviewOutcome',
    label: 'Rejected or approved',
    description: 'A build you pushed was reviewed. Rejections include the reason.',
  },
]

export const preferencesQuery = () =>
  queryOptions({
    queryKey: keys.notificationPreferences(),
    queryFn: () => getJson<Inbox.Preferences>('/api/inbox/preferences'),
  })

/**
 * Saves one preference the moment it flips: the switch moves at once, and goes back if the
 * server says no.
 */
export function useSetPreference() {
  const queryClient = useQueryClient()
  const key = preferencesQuery().queryKey
  return useMutation({
    meta: { what: 'save' },
    mutationFn: (change: Partial<Inbox.Preferences>) =>
      send<Inbox.Preferences>('PUT', '/api/inbox/preferences', change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Inbox.Preferences>(key)
      if (previous) queryClient.setQueryData<Inbox.Preferences>(key, { ...previous, ...change })
      return { previous }
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

// ---- Email address ----------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What is wrong with an address typed for the account, or null. */
export const emailProblem = (email: string): string | null =>
  EMAIL.test(email.trim()) && email.trim().length <= 254 ? null : 'Enter a valid email address'

/** The address whose confirmation mail is still waiting to be opened, if any. */
export const emailChangeQuery = () =>
  queryOptions({
    queryKey: keys.emailChange(),
    queryFn: () => getJson<Account.EmailChange>('/api/account/email-change'),
  })

/**
 * Asks for the change: better-auth mails a confirmation link to the new address (and a notice to
 * the old one); the address changes only when the link is opened. The server's reason (in use,
 * not an address) is the error shown on the field.
 */
export function useChangeEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'change your email' },
    mutationFn: async (newEmail: string) => {
      const { error } = await authClient.changeEmail({ newEmail, callbackURL: '/account/profile' })
      if (error) throw new Error(error.message ?? "Couldn't change your email")
      return newEmail
    },
    // The server noted the request before it answered; not refetched, so a slow note can't undo it.
    onSuccess: (newEmail) =>
      queryClient.setQueryData<Account.EmailChange>(keys.emailChange(), { pendingEmail: newEmail }),
  })
}
