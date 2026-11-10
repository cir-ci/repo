import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { createAppRouter } from '#app/router.tsx'
import { rememberWorkspace } from '#app/shell-model.ts'
import { renderPage } from '#test/support/render.tsx'

const overview = (workspace: string, name: string) => ({
  workspace: { slug: workspace, name },
  team: { slug: 'web', name: 'web', defaultBranch: 'main' },
  latestBuild: null,
})

const api = (teams: unknown[], lastWorkspace: string | null = null) => ({
  'GET /api/teams': { body: { teams } },
  'GET /api/capabilities': {
    body: {
      manageableWorkspaces: [],
      refusingWorkspaces: [],
      canCreateWorkspace: false,
      lastWorkspace,
    },
  },
  'PUT /api/workspaces/acme/last-opened': { status: 204 },
  'PUT /api/workspaces/beta/last-opened': { status: 204 },
})

async function open(
  url: string,
  teams: unknown[],
  beforeRender?: () => void,
  lastWorkspace: string | null = null,
) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  const { calls } = await renderPage(null, {
    router,
    api: api(teams, lastWorkspace),
    ...(beforeRender ? { beforeRender } : {}),
  })
  return { router, calls }
}
const writes = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/last-opened')).map((c) => c.path)

describe('/reviews and /insights without a workspace', () => {
  it.each(['reviews', 'insights'])('/%s opens the first workspace', async (name) => {
    const { router } = await open(`/${name}`, [overview('beta', 'Beta'), overview('acme', 'Acme')])
    // The first by name, as the sidebar picks.
    await expect.poll(() => router.state.location.pathname).toBe(`/workspaces/acme/${name}`)
  })

  it('opens the workspace chosen last when it is still one of theirs', async () => {
    const { router } = await open(
      '/insights',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      () => rememberWorkspace('beta'),
    )
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/beta/insights')
  })

  it("opens the workspace the account remembers, over this browser's own choice", async () => {
    const { router } = await open(
      '/reviews',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      () => rememberWorkspace('acme'),
      'beta',
    )
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/beta/reviews')
  })

  it("on a browser that remembers nothing, opens the account's workspace, not the first", async () => {
    const { router } = await open(
      '/insights',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      undefined,
      'beta',
    )
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/beta/insights')
  })

  it("falls back to this browser's choice, then the first, when the account's workspace is gone", async () => {
    const gone = await open(
      '/reviews',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      () => rememberWorkspace('beta'),
      'deleted-space',
    )
    await expect.poll(() => gone.router.state.location.pathname).toBe('/workspaces/beta/reviews')
  })

  it('falls back to the first workspace when neither remembered one is still theirs', async () => {
    const { router } = await open(
      '/reviews',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      () => rememberWorkspace('also-gone'),
      'deleted-space',
    )
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/reviews')
  })

  it('says the page does not exist for someone with no workspace', async () => {
    await open('/reviews', [])
    await expect
      .element(page.getByRole('heading', { name: "This page doesn't exist" }))
      .toBeVisible()
  })
})

describe('/login while signed in', () => {
  it('goes to the app instead of saying the page does not exist', async () => {
    const { router } = await open('/login', [overview('acme', 'Acme')])
    await expect.poll(() => router.state.location.pathname).toBe('/')
    expect(page.getByRole('heading', { name: "This page doesn't exist" }).elements()).toHaveLength(
      0,
    )
  })
})

describe('remembering the workspace on the server', () => {
  it('writes a workspace that is opened and is not the remembered one, once', async () => {
    const { calls } = await open(
      '/workspaces/beta/reviews?tab=for-you',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      undefined,
      'acme',
    )
    await expect.poll(() => writes(calls)).toEqual(['/api/workspaces/beta/last-opened'])
    // The same address again (the cache has the new value): nothing more is written.
    await new Promise((r) => setTimeout(r, 200))
    expect(writes(calls)).toHaveLength(1)
  })

  it('writes nothing for the workspace the server already remembers', async () => {
    const { calls } = await open(
      '/workspaces/acme/reviews?tab=for-you',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      undefined,
      'acme',
    )
    await expect.poll(() => calls.some((c) => c.path === '/api/capabilities')).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect(writes(calls)).toEqual([])
  })

  it("never writes a workspace that isn't theirs", async () => {
    const { calls } = await open(
      '/workspaces/stranger/reviews?tab=for-you',
      [overview('beta', 'Beta')],
      undefined,
      'beta',
    )
    await expect.poll(() => calls.some((c) => c.path === '/api/capabilities')).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect(writes(calls)).toEqual([])
  })
})
