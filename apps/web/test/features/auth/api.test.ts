import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { authMethodsQuery, setupQuery, submitSetup } from '../../../src/features/auth/api.ts'
import { fakeFetch, restoreFetch, json } from '../fetch-routes.ts'

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

describe('submitSetup', () => {
  const input = {
    code: 'abc',
    name: 'Ada',
    email: 'ada@example.com',
    password: 'correct horse battery',
    organizationName: 'Acme',
  }

  it('posts the first account and its organization', async () => {
    const calls = fakeFetch({ 'POST /api/setup': { email: 'ada@example.com' } })
    expect(await submitSetup(input)).toEqual({ email: 'ada@example.com' })
    expect(calls[0]?.body).toEqual(input)
  })

  it('rejects with the server’s message', async () => {
    fakeFetch({ 'POST /api/setup': json({ error: 'Wrong setup code' }, 403) })
    await expect(submitSetup(input)).rejects.toThrow('Wrong setup code')
  })
})
