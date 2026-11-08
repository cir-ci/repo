import { queryOptions } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'

import type { LinkedAccount } from './model.ts'

export const sessionsKey = ['sessions'] as const
export const accountsKey = ['linked-accounts'] as const

export const sessionsQuery = () =>
  queryOptions({
    queryKey: sessionsKey,
    queryFn: async () => {
      const { data, error } = await authClient.listSessions()
      if (error || !data) throw new Error('Couldn’t load your sessions')
      return data.toSorted((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    },
  })

export const accountsQuery = () =>
  queryOptions({
    queryKey: accountsKey,
    queryFn: async (): Promise<LinkedAccount[]> => {
      const { data, error } = await authClient.listAccounts()
      if (error || !data) throw new Error('Couldn’t load your linked accounts')
      return data
    },
  })
