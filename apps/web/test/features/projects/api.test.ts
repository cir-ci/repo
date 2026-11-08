import { afterEach, describe, expect, it, vi } from 'vitest'

import { isActive } from '#features/builds/api.ts'
import {
  BUILDS_PAGE_SIZE,
  capabilitiesQuery,
  flakyQuery,
  projectQuery,
  projectsQuery,
  settingsQuery,
} from '#features/projects/api.ts'
import { restoreFetch } from '#test/features/fetch-routes.ts'

function stubFetch(body: unknown) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => restoreFetch())

/** Runs a query's fetcher the way TanStack Query would. */
async function run(options: { queryFn?: unknown; queryKey: readonly unknown[] }) {
  const fn = options.queryFn
  if (typeof fn !== 'function') throw new Error('no queryFn')
  const result: unknown = await fn({ queryKey: options.queryKey })
  return result
}

describe('projects queries', () => {
  it('lists projects from /api/projects', async () => {
    const fetcher = stubFetch({ projects: [] })
    expect(await run(projectsQuery())).toEqual({ projects: [] })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/projects')
    expect(projectsQuery().queryKey).toEqual(['projects'])
  })

  it('fetches one project’s builds, escaping the path and adding the page cursor', async () => {
    const fetcher = stubFetch({})
    await run(projectQuery('my org', 'web/app'))
    await run(projectQuery('acme', 'web', 40))
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/my%20org/web%2Fapp',
      '/api/projects/acme/web?before=40',
    ])
  })

  it('keys the builds list by the page, so each page is cached on its own', () => {
    expect(projectQuery('acme', 'web').queryKey).toEqual(['project', 'acme', 'web', null])
    expect(projectQuery('acme', 'web', 40).queryKey).toEqual(['project', 'acme', 'web', 40])
  })

  it('polls every 3 seconds while a build is still running, and stops when all are done', () => {
    const interval = projectQuery('acme', 'web').refetchInterval
    if (typeof interval !== 'function') throw new Error('expected a function')
    const at = (statuses: string[]) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      interval({ state: { data: { builds: statuses.map((status) => ({ status })) } } } as never)
    expect(isActive('processing')).toBe(true)
    expect(at(['complete', 'processing'])).toBe(3_000)
    expect(at(['complete', 'error'])).toBe(false)
  })

  it('loads capabilities, settings and the flaky report from their own addresses', async () => {
    const fetcher = stubFetch({})
    await run(capabilitiesQuery())
    await run(settingsQuery('acme', 'web'))
    await run(flakyQuery('acme', 'web'))
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/capabilities',
      '/api/projects/acme/web/settings',
      '/api/projects/acme/web/flaky',
    ])
  })

  it('asks for a page of the size the server returns', () => {
    expect(BUILDS_PAGE_SIZE).toBe(50)
  })
})
