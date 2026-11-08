import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import {
  formatSize,
  projectSitesQuery,
  requestSiteAccess,
} from '../../../src/features/sites/api.ts'
import { fakeFetch, restoreFetch, json } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

describe('formatSize', () => {
  it.each([
    [0, '1 kB'],
    [1, '1 kB'],
    [1536, '2 kB'],
    [1024 * 1024 - 1, '1024 kB'],
    [1024 * 1024, '1.0 MB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
  ])('%d bytes is %s', (bytes, label) => {
    expect(formatSize(bytes)).toBe(label)
  })
})

describe('projectSitesQuery', () => {
  it('is keyed by project and escapes both path segments', async () => {
    const calls = fakeFetch({
      'GET /api/projects/my%20org/web%2Fapp/sites': { configured: true, sites: [] },
    })
    const query = projectSitesQuery('my org', 'web/app')
    expect(query.queryKey).toEqual(['project-sites', 'my org', 'web/app'])
    expect(await new QueryClient().fetchQuery(query)).toEqual({ configured: true, sites: [] })
    expect(calls).toHaveLength(1)
  })
})

describe('requestSiteAccess', () => {
  it('posts the address and the path to return to', async () => {
    const calls = fakeFetch({ 'POST /api/site-handoff': { url: 'https://x.test/go' } })
    expect(await requestSiteAccess('acme--web.sites.test', '/a')).toEqual({
      url: 'https://x.test/go',
    })
    expect(calls[0]?.body).toEqual({ label: 'acme--web.sites.test', returnPath: '/a' })
  })

  it('rejects when access is refused', async () => {
    fakeFetch({ 'POST /api/site-handoff': json({ error: 'nope' }, 404) })
    await expect(requestSiteAccess('x', '/')).rejects.toThrow('nope')
  })
})
