import { createMemoryHistory } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '#app/router.tsx'

async function open(url: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  await router.load()
  return router
}

describe('the app router', () => {
  it('sends /<workspace>/settings to the workspace settings, not to a project called "settings"', async () => {
    const router = await open('/acme/settings')
    expect(router.state.location.pathname).toBe('/workspaces/acme/settings')
    expect(router.state.matches.at(-1)?.routeId).toBe('/workspaces/$workspace/settings')
  })

  it('sends /<workspace>/<project>/builds to the project page, keeping the search and replacing the entry', async () => {
    const history = createMemoryHistory({ initialEntries: ['/acme/web-app/builds?branch=main'] })
    const router = createAppRouter({ history })
    await router.load()
    expect(router.state.location.pathname).toBe('/acme/web-app')
    expect(router.state.location.search).toMatchObject({ branch: 'main' })
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$project')
    // Replaced, not pushed: Back doesn't land on the address that redirects again.
    expect(history.length).toBe(1)
    // A build's own address is untouched.
    const build = await open('/acme/web-app/builds/7')
    expect(build.state.matches.at(-1)?.routeId).toBe('/$workspace/$project/builds/$number')
  })

  it("sends a project's insights and reviews addresses to the workspace's pages", async () => {
    const history = createMemoryHistory({ initialEntries: ['/acme/web-app/insights'] })
    const insights = createAppRouter({ history })
    await insights.load()
    expect(insights.state.location.pathname).toBe('/workspaces/acme/insights')
    expect(insights.state.location.search).toMatchObject({ project: 'web-app' })
    expect(history.length).toBe(1)
    const reviews = await open('/acme/web-app/reviews')
    expect(reviews.state.location.pathname).toBe('/workspaces/acme/reviews')
    expect(reviews.state.matches.at(-1)?.routeId).toBe('/workspaces/$workspace/reviews')
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

  it('has the Instance hub at /instance/overview, and /instance goes there', async () => {
    const hub = await open('/instance/overview')
    expect(hub.state.matches.at(-1)?.routeId).toBe('/instance/overview')
    const front = await open('/instance')
    expect(front.state.location.pathname).toBe('/instance/overview')
  })

  it('sends the GitHub App result at /instance on to Instance settings, keeping it', async () => {
    const router = await open('/instance?githubApp=failed')
    expect(router.state.location.pathname).toBe('/instance/settings')
    expect(router.state.location.search).toEqual({ githubApp: 'failed' })
  })

  it('still reads /<workspace>/<project> as a project', async () => {
    const router = await open('/acme/web')
    expect(router.state.location.pathname).toBe('/acme/web')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$project')
  })

  it('keeps the baselines list at its own address, not a baseline with no name', async () => {
    const router = await open('/acme/web/baselines')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$project/baselines/')
  })

  it('opens a baseline page on its screenshot name, slashes included', async () => {
    const router = await open('/acme/web/baselines/checkout/payment-form')
    expect(router.state.matches.at(-1)?.routeId).toBe('/$workspace/$project/baselines/$')
    expect(router.state.matches.at(-1)?.params).toMatchObject({ _splat: 'checkout/payment-form' })
  })

  it('writes and reads back a screenshot name with spaces and symbols', async () => {
    const name = 'cart/price (€) 50% off?#1 + 2'
    const router = await open('/acme/web')
    const href = router.buildLocation({
      to: '/$workspace/$project/baselines/$',
      params: { workspace: 'acme', project: 'web', _splat: name },
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
    expect(router.state.matches.at(-1)?.routeId).toBe(
      '/$workspace/$project/settings/ignore-regions/',
    )
  })

  it.each([
    ['/acme/web/settings', '/$workspace/$project/settings'],
    ['/acme/web/settings/general', '/$workspace/$project/settings/general'],
    ['/acme/web/settings/token', '/$workspace/$project/settings/token'],
    ['/acme/web/settings/reviews', '/$workspace/$project/settings/reviews'],
    ['/acme/web/settings/webhooks', '/$workspace/$project/settings/webhooks'],
    ['/acme/web/settings/members', '/$workspace/$project/settings/members'],
    ['/acme/web/settings/sites', '/$workspace/$project/settings/sites'],
    [
      '/acme/web/settings/ignore-regions/checkout/form',
      '/$workspace/$project/settings/ignore-regions/$',
    ],
    ['/workspaces/acme/settings/projects', '/workspaces/$workspace/settings/projects'],
  ])('keeps %s working: it opens %s', async (url, routeId) => {
    const router = await open(url)
    expect(router.state.location.pathname).toBe(url)
    expect(router.state.matches.at(-1)?.routeId).toBe(routeId)
  })
})
