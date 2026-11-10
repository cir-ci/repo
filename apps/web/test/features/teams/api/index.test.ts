import { afterEach, describe, expect, it, vi } from 'vitest'

import { isActive } from '#features/builds/api/index.ts'
import {
  BUILDS_PAGE_SIZE,
  capabilitiesQuery,
  flakyQuery,
  teamQuery,
  teamsQuery,
  settingsQuery,
} from '#features/teams/api/index.ts'
import { restoreFetch } from '#test/support/fetch.ts'

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

describe('teams queries', () => {
  it('lists teams from /api/teams', async () => {
    const fetcher = stubFetch({ teams: [] })
    expect(await run(teamsQuery())).toEqual({ teams: [] })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/teams')
    expect(teamsQuery().queryKey).toEqual(['teams'])
  })

  it("fetches one team's builds, escaping the path and adding the page cursor", async () => {
    const fetcher = stubFetch({})
    await run(teamQuery('my workspace', 'web/app'))
    await run(teamQuery('acme', 'web', 40))
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/teams/my%20workspace/web%2Fapp',
      '/api/teams/acme/web?before=40',
    ])
  })

  it('keys the builds list by the page, so each page is cached on its own', () => {
    expect(teamQuery('acme', 'web').queryKey).toEqual(['team', 'acme', 'web', null])
    expect(teamQuery('acme', 'web', 40).queryKey).toEqual(['team', 'acme', 'web', 40])
  })

  it('polls every 3 seconds while a build is still running, and stops when all are done', () => {
    const interval = teamQuery('acme', 'web').refetchInterval
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
      '/api/teams/acme/web/settings',
      '/api/teams/acme/web/flaky',
    ])
  })

  it('asks for a page of the size the server returns', () => {
    expect(BUILDS_PAGE_SIZE).toBe(50)
  })
})
