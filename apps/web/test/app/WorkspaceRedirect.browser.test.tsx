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

const api = (teams: unknown[]) => ({
  'GET /api/teams': { body: { teams } },
  'GET /api/capabilities': {
    body: { manageableWorkspaces: [], refusingWorkspaces: [], canCreateWorkspace: false },
  },
})

async function open(url: string, teams: unknown[], beforeRender?: () => void) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  await renderPage(null, { router, api: api(teams), ...(beforeRender ? { beforeRender } : {}) })
  return router
}

describe('/reviews and /insights without a workspace', () => {
  it.each(['reviews', 'insights'])('/%s opens the first workspace', async (name) => {
    const router = await open(`/${name}`, [overview('beta', 'Beta'), overview('acme', 'Acme')])
    // The first by name, as the sidebar picks.
    await expect.poll(() => router.state.location.pathname).toBe(`/workspaces/acme/${name}`)
  })

  it('opens the workspace chosen last when it is still one of theirs', async () => {
    const router = await open(
      '/insights',
      [overview('beta', 'Beta'), overview('acme', 'Acme')],
      () => rememberWorkspace('beta'),
    )
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/beta/insights')
  })

  it('says the page does not exist for someone with no workspace', async () => {
    await open('/reviews', [])
    await expect
      .element(page.getByRole('heading', { name: 'This page doesn’t exist' }))
      .toBeVisible()
  })
})
