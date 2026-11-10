import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { authMethodsQuery, setupQuery } from '#features/auth/api.ts'
import { fakeFetch, restoreFetch } from '#test/support/fetch.ts'

afterEach(() => restoreFetch())

describe('auth queries', () => {
  it('asks for the sign-in methods, cached for five minutes', async () => {
    const calls = fakeFetch({
      'GET /api/auth-methods': { password: true, email: false, sso: [] },
    })
    const query = authMethodsQuery()
    expect(query.staleTime).toBe(5 * 60_000)
    expect(await new QueryClient().fetchQuery(query)).toEqual({
      password: true,
      email: false,
      sso: [],
    })
    expect(calls).toHaveLength(1)
  })

  it('checks whether setup is needed, never from cache', async () => {
    fakeFetch({ 'GET /api/setup': { needed: true } })
    const query = setupQuery()
    expect(query.staleTime).toBe(0)
    expect(await new QueryClient().fetchQuery(query)).toEqual({ needed: true })
  })
})
