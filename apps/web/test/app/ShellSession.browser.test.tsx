import { CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import type * as QueryPersist from '#lib/query-persist.ts'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)
// The stored cache is IndexedDB: what the shell asks of it is the point here, not the storage.
vi.mock('#lib/query-persist.ts', async (importOriginal) => ({
  // The in-memory part is real: the tests check what is left in the client.
  forgetQueries: (await importOriginal<typeof QueryPersist>()).forgetQueries,
  purgePersisted: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  startPersisting: vi.fn<(client: unknown, userId: string) => void>(),
  restorePersisted: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}))

import { createQueryClient } from '#app/providers.tsx'
import { Shell } from '#app/Shell.tsx'
import { HttpError } from '#lib/http.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { purgePersisted, startPersisting } from '#lib/query-persist.ts'
import { readSessionHint, SESSION_HINT_KEY, writeSessionHint } from '#lib/session-hint.ts'
import { ADA, mockAuthClient, setSessionCheck, setSignedInUser } from '#test/support/auth-client.ts'
import { installDefaultFetch } from '#test/support/fetch.ts'

const BOB = { id: 'u2', name: 'Bob', email: 'bob@example.test', image: null }

const auth = mockAuthClient()

beforeEach(() => {
  installDefaultFetch()
  vi.mocked(purgePersisted).mockClear()
  vi.mocked(startPersisting).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
        .pathname
      const bodies: Record<string, unknown> = {
        '/api/capabilities': {
          canCreateWorkspace: false,
          instanceAdmin: false,
          manageableWorkspaces: [],
          refusingWorkspaces: [],
        },
        '/api/setup': { needed: false },
      }
      return Promise.resolve(
        new Response(JSON.stringify(bodies[path] ?? {}), { status: path in bodies ? 200 : 404 }),
      )
    }),
  )
})

async function renderShell() {
  const root = createRootRoute({ component: Shell })
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <PageHeading title="Projects page" />,
    }),
    createRoute({
      getParentRoute: () => root,
      path: 'inbox',
      component: () => <PageHeading title="Inbox page" />,
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>,
  )
  return { router, queryClient }
}

describe('Shell draws the app before the session check answers', () => {
  it('shows the app at once for a remembered person, and starts storing their cache once verified', async () => {
    writeSessionHint(ADA)
    setSessionCheck({ pending: true })
    setSignedInUser(null)
    const { router } = await renderShell()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
    expect(page.getByText('Checking your session…').elements()).toHaveLength(0)
    // Not verified yet: nothing is stored or switched.
    expect(startPersisting).not.toHaveBeenCalled()
    expect(purgePersisted).not.toHaveBeenCalled()

    setSignedInUser(ADA)
    setSessionCheck({ pending: false })
    router.history.push('/inbox')
    await expect.element(page.getByRole('heading', { name: 'Inbox page' })).toBeVisible()
    expect(startPersisting).toHaveBeenCalledWith(expect.anything(), ADA.id)
    expect(purgePersisted).not.toHaveBeenCalled()
    expect(readSessionHint()).toEqual(ADA)
  })

  it('waits for the check, as before, when nobody is remembered', async () => {
    setSessionCheck({ pending: true })
    setSignedInUser(null)
    await renderShell()
    await expect.element(page.getByText('Checking your session…')).toBeVisible()
    expect(page.getByRole('heading', { name: 'Projects page' }).elements()).toHaveLength(0)
  })

  it('goes to sign-in, and clears the stored and in-memory data, when the check finds no session', async () => {
    writeSessionHint(ADA)
    setSessionCheck({ pending: true })
    setSignedInUser(null)
    const { router, queryClient } = await renderShell()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
    queryClient.setQueryData(['inbox', 'for-you'], { items: [] })

    setSessionCheck({ pending: false })
    router.history.push('/inbox')
    await expect.element(page.getByRole('heading', { name: 'Sign in to CirCI' })).toBeVisible()
    expect(purgePersisted).toHaveBeenCalled()
    expect(queryClient.getQueryData(['inbox', 'for-you'])).toBeUndefined()
  })

  it("drops the remembered person's data when the session turns out to be someone else's", async () => {
    writeSessionHint(ADA)
    setSessionCheck({ pending: true })
    setSignedInUser(null)
    const { router, queryClient } = await renderShell()
    queryClient.setQueryData(['inbox', 'for-you'], { items: [] })

    setSignedInUser(BOB)
    setSessionCheck({ pending: false })
    router.history.push('/inbox')
    await expect.element(page.getByRole('heading', { name: 'Inbox page' })).toBeVisible()
    expect(purgePersisted).toHaveBeenCalled()
    expect(queryClient.getQueryData(['inbox', 'for-you'])).toBeUndefined()
    expect(startPersisting).toHaveBeenCalledWith(expect.anything(), BOB.id)
    expect(localStorage.getItem(SESSION_HINT_KEY)).toContain(BOB.id)
  })

  it('keeps a remembered person in the app when the check cannot reach the server', async () => {
    writeSessionHint(ADA)
    setSessionCheck({ pending: false, error: { status: 0 } })
    setSignedInUser(null)
    await renderShell()
    await expect.element(page.getByRole('heading', { name: 'Projects page' })).toBeVisible()
    expect(purgePersisted).not.toHaveBeenCalled()
  })
})

describe('a 401 from any request', () => {
  it('re-checks the session and drops the stored cache (a query)', async () => {
    const notify = vi.spyOn(auth.$store, 'notify')
    const queryClient = createQueryClient()
    await expect(
      queryClient.fetchQuery({
        queryKey: ['inbox', 'for-you'],
        retry: false,
        queryFn: () => Promise.reject(new HttpError(401, 'Not signed in')),
      }),
    ).rejects.toBeInstanceOf(HttpError)
    // Asks the server past the cookie cache, then lets the app notice.
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('$sessionSignal'))
    expect(auth.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } })
    expect(purgePersisted).toHaveBeenCalled()
  })

  it('does the same for a change', async () => {
    const notify = vi.spyOn(auth.$store, 'notify')
    const queryClient = createQueryClient()
    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => Promise.reject(new HttpError(401, 'Not signed in')),
        })
        .execute(undefined),
    ).rejects.toBeInstanceOf(HttpError)
    // Asks the server past the cookie cache, then lets the app notice.
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('$sessionSignal'))
    expect(auth.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } })
    expect(purgePersisted).toHaveBeenCalled()
  })

  it("leaves other errors alone: a 500 doesn't end the session", async () => {
    const queryClient = createQueryClient()
    await expect(
      queryClient.fetchQuery({
        queryKey: ['inbox', 'for-you'],
        retry: false,
        queryFn: () => Promise.reject(new HttpError(500, 'Boom')),
      }),
    ).rejects.toBeInstanceOf(HttpError)
    expect(purgePersisted).not.toHaveBeenCalled()
  })
})
