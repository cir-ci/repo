import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { parseIgnoreRegionsSearch } from '#features/regions/ignore-regions-search.ts'
import { IgnoreRegionsPage } from '#features/regions/IgnoreRegionsPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/teams/acme/web'

const snapshot = (name: string, regions: number) => ({
  name,
  regions,
  latest: { buildNumber: 148, sha256: 'sha', width: 1000, height: 500 },
})

function api(snapshots: unknown[], canManage = true, extra: Record<string, ReplyHandler> = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: {
      body: {
        canManage,
        settings: { name: 'Web App', defaultBranch: 'main' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [],
        webhookEvents: [],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
      },
    },
    [`GET ${API}/ignore-regions`]: { body: { regions: [], snapshots } },
    ...extra,
  })
}

const show = () =>
  renderPage(<IgnoreRegionsPage />, {
    route: '/$workspace/$team/settings/ignore-regions/',
    url: '/acme/web/settings/ignore-regions',
    announcer: true,
    validateSearch: parseIgnoreRegionsSearch,
    otherRoutes: ['/$workspace/$team/settings/ignore-regions/$'],
  })

describe('IgnoreRegionsPage (the team settings overview)', () => {
  it('lists the screenshots that have ignore regions with their counts, each opening its baseline inside settings', async () => {
    api([snapshot('checkout/summary', 2), snapshot('nav/header', 1)])
    await show()
    const list = page.getByRole('list', { name: 'Screenshots with ignore regions' })
    const summary = list.getByRole('link', { name: /checkout\/summary/ })
    await expect
      .element(summary)
      .toHaveAttribute('href', '/acme/web/settings/ignore-regions/checkout/summary')
    await expect
      .element(list.getByRole('link', { name: /nav\/header/ }))
      .toHaveAttribute('href', '/acme/web/settings/ignore-regions/nav/header')
    await expect.element(page.getByLabelText('2 regions')).toBeVisible()
    await expect.element(page.getByLabelText('1 region')).toBeVisible()
    expect(document.title).toBe('Ignore regions · web · CirCI')
  })

  it('is the same read-only list for everyone: no editing controls', async () => {
    api([snapshot('checkout/summary', 2)], false)
    await show()
    await expect.element(page.getByRole('link', { name: /checkout\/summary/ })).toBeVisible()
    expect(page.getByRole('button', { name: /region/i }).elements()).toHaveLength(0)
  })

  it('leaves out screenshots without regions', async () => {
    api([snapshot('checkout/summary', 2), snapshot('clock', 0)])
    await show()
    await expect.element(page.getByRole('link', { name: /checkout\/summary/ })).toBeVisible()
    expect(page.getByRole('link', { name: /clock/ }).elements()).toHaveLength(0)
  })

  it('says so when there are no regions yet', async () => {
    api([])
    await show()
    await expectEmptyState('No ignore regions yet', {
      body: "Add one from a screenshot's baseline page.",
    })
  })

  it('shows a failed load and retries', async () => {
    const fake = api([snapshot('checkout/summary', 1)])
    fake.set(`GET ${API}/ignore-regions`, { status: 500, body: { error: 'db down' } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/ignore-regions`, { body: { regions: [], snapshots: [snapshot('a', 1)] } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect
      .element(page.getByRole('list', { name: 'Screenshots with ignore regions' }))
      .toBeVisible()
  })
})
