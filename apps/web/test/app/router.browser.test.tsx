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

  it('has the bare workspace settings address and General at its own', async () => {
    const hub = await open('/workspaces/acme/settings')
    expect(hub.state.matches.at(-1)?.routeId).toBe('/workspaces/$workspace/settings')
    const general = await open('/workspaces/acme/settings/general')
    expect(general.state.location.pathname).toBe('/workspaces/acme/settings/general')
    expect(general.state.matches.at(-1)?.routeId).toBe('/workspaces/$workspace/settings/general')
  })

  it('has the All workspaces page at /instance/workspaces', async () => {
    const router = await open('/instance/workspaces')
    expect(router.state.matches.at(-1)?.routeId).toBe('/instance/workspaces')
  })

  it('still reads /<workspace>/<team> as a team', async () => {
    const router = await open('/acme/web')
    expect(router.state.location.pathname).toBe('/acme/web')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$team')
  })

  it('keeps the baselines list at its own address, not a baseline with no name', async () => {
    const router = await open('/acme/web/baselines')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$team/baselines/')
  })

  it('opens a baseline page on its screenshot name, slashes included', async () => {
    const router = await open('/acme/web/baselines/checkout/payment-form')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$team/baselines/$')
    expect(router.state.matches.at(-1)?.params).toMatchObject({ _splat: 'checkout/payment-form' })
  })

  it('writes and reads back a screenshot name with spaces and symbols', async () => {
    const name = 'cart/price (€) 50% off?#1 + 2'
    const router = await open('/acme/web')
    const href = router.buildLocation({
      to: '/$workspace/$team/baselines/$',
      params: { workspace: 'acme', team: 'web', _splat: name },
    }).href
    expect(href.split('/baselines/')[1]).not.toMatch(/[ ?#]/)
    const back = await open(href)
    expect(back.state.matches.at(-1)?.params).toMatchObject({ _splat: name })
  })

  it("sends the old ignore regions address with ?name= to that screenshot's page inside settings", async () => {
    const router = await open('/acme/web/settings/ignore-regions?name=checkout%2Fpayment-form')
    expect(router.state.location.pathname).toBe(
      '/acme/web/settings/ignore-regions/checkout/payment-form',
    )
    expect(router.state.location.search).toEqual({})
  })

  it('keeps the ignore regions overview at its address', async () => {
    const router = await open('/acme/web/settings/ignore-regions')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$team/settings/ignore-regions/')
  })

  it.each([
    ['/acme/web/settings', '/$workspace/$team/settings'],
    ['/acme/web/settings/general', '/$workspace/$team/settings/general'],
    ['/acme/web/settings/token', '/$workspace/$team/settings/token'],
    ['/acme/web/settings/reviews', '/$workspace/$team/settings/reviews'],
    ['/acme/web/settings/webhooks', '/$workspace/$team/settings/webhooks'],
    ['/acme/web/settings/members', '/$workspace/$team/settings/members'],
    ['/acme/web/settings/sites', '/$workspace/$team/settings/sites'],
    [
      '/acme/web/settings/ignore-regions/checkout/form',
      '/$workspace/$team/settings/ignore-regions/$',
    ],
    ['/workspaces/acme/settings/teams', '/workspaces/$workspace/settings/teams'],
  ])('keeps %s working: it opens %s', async (url, routeId) => {
    const router = await open(url)
    expect(router.state.location.pathname).toBe(url)
    expect(router.state.matches.at(-1)?.routeId).toBe(routeId)
  })
})
