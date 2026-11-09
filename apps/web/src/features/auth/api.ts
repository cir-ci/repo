import type { Instance } from '@circi/api'
import { queryOptions } from '@tanstack/react-query'

import { getJson, post } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

/** What the sign-in page can offer. Public. */
export const authMethodsQuery = () =>
  queryOptions({
    queryKey: keys.authMethods(),
    queryFn: () => getJson<Instance.AuthMethods>('/api/auth-methods'),
    staleTime: 5 * 60_000,
  })

export const setupQuery = () =>
  queryOptions({
    queryKey: keys.setup(),
    queryFn: () => getJson<{ needed: boolean }>('/api/setup'),
    staleTime: 0,
  })

export const submitSetup = (input: {
  code: string
  name: string
  email: string
  password: string
  workspaceName: string
}) => post<{ email: string }>('/api/setup', input)
