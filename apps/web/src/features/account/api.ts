import type { Inbox } from '@circi/api'
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
