import { CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
const auth = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' } as {
    id: string
    name: string
    email: string
  } | null,
}))
vi.mock('#lib/auth-client.ts', () => ({
  authClient: {
    useSession: () => ({
      data: auth.user ? { user: auth.user, session: { id: 's1', token: 't' } } : null,
      isPending: false,
    }),
    listSessions: async () => ({ data: [], error: null }),
    listAccounts: async () => ({ data: [], error: null }),
    signOut: async () => {},
    signIn: { email: async () => ({ data: null, error: new Error('no') }) },
    $store: { notify: () => {} },
    organization: { getInvitation: async () => ({ data: null, error: new Error('none') }) },
  },
}))

import { createAppRouter } from '#app/router.tsx'
import { resetStores } from '#lib/stores/index.ts'
import { fakeFetch, hangingFetch, restoreFetch } from '#test/features/fetch-routes.ts'

/** What each `$param` of an address stands for in this test. */
const SAMPLE: Record<string, string> = {
  workspace: 'acme',
  team: 'web',
  number: '1',
  kind: 'github',
  id: '8c1b0a52-6d3f-4a39-9f0e-5a3a1d7f2b11',
  view: 'v1',
}
const address = (path: string) =>
  path.replaceAll(/\$(\w+)/g, (_, name: string) => SAMPLE[name] ?? 'x')

/** Every address the app declares (redirects included: they end on a page that must have its h1 too). */
const PATHS = Object.keys(createAppRouter().routesByPath).filter((p) => p !== '/*')

async function open(url: string) {
  resetStores()
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>,
  )
}

const h1s = () => page.getByRole('heading', { level: 1 }).elements()

/** The h1s once the page has settled: it waits for the first, then lets anything late arrive. */
async function settledH1s() {
  await expect.poll(() => h1s().length, { timeout: 5_000 }).toBeGreaterThan(0)
  await new Promise((resolve) => setTimeout(resolve, 250))
  return h1s().map((el) => el.textContent)
}

beforeEach(() => {
  auth.user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' }
})
afterEach(() => restoreFetch())

describe('every page has exactly one h1', () => {
  it('knows the app’s addresses', () => {
    // A guard that the enumeration works, so the loops below cannot pass by checking nothing.
    expect(PATHS.length).toBeGreaterThan(30)
    expect(PATHS).toContain('/inbox')
    expect(PATHS).toContain('/$workspace/$team/builds/$number')
  })

  describe.each([
    ['while loading', () => hangingFetch()],
    ['when the server answers 404', () => void fakeFetch({ 'GET /api/setup': { needed: false } })],
  ])('%s', (_name, stub) => {
    it.each(PATHS)('%s', async (path) => {
      await page.viewport(1280, 800)
      stub()
      await open(address(path))
      expect(await settledH1s()).toHaveLength(1)
    })
  })

  it('has one on an address that does not exist', async () => {
    fakeFetch({})
    await open('/no/such/page/at/all')
    expect(await settledH1s()).toHaveLength(1)
  })

  it('has one on the sign-in page', async () => {
    auth.user = null
    fakeFetch({
      'GET /api/setup': { needed: false },
      'GET /api/auth-methods': { password: true, email: false, sso: [] },
    })
    await open('/')
    expect(await settledH1s()).toHaveLength(1)
  })
})
