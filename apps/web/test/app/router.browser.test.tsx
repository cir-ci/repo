import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '#app/router.tsx'

async function open(url: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  await router.load()
  return router
}

describe('the app router', () => {
  it('sends /<workspace>/settings to the workspace settings, not to a team called "settings"', async () => {
    const router = await open('/acme/settings')
    expect(router.state.location.pathname).toBe('/workspaces/acme/settings')
    expect(router.state.matches.at(-1)?.routeId).toBe('/workspaces/$workspace/settings')
  })

  it('still reads /<workspace>/<team> as a team', async () => {
    const router = await open('/acme/web')
    expect(router.state.location.pathname).toBe('/acme/web')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$team')
  })
})
