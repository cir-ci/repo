import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { AccountsPage } from '#features/instance/AccountsPage.tsx'
import { HealthPage } from '#features/instance/HealthPage.tsx'
import { InstanceSettingsPage } from '#features/instance/InstanceSettingsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { accountList, settingsFixture } from './fixtures.ts'

const ROUTES = {
  'GET /api/instance/accounts': { body: accountList([]) },
  'GET /api/instance/settings': { body: settingsFixture() },
  'GET /api/instance/github-app': {
    body: { configured: false, source: 'none', canManage: true, slug: null, name: null },
  },
  'GET /api/instance/health/checks': { body: { warned: false, findings: [] } },
  'GET /api/instance/health/queues': { body: { queues: [] } },
  'GET /api/instance/health/address-checklist': {
    body: { publicUrl: 'https://ci.acme.io', previousHosts: [], dismissed: false, steps: [] },
  },
}

const PAGES: Array<[string, string, ComponentType]> = [
  ['Accounts', '/instance/accounts', AccountsPage],
  ['Instance settings', '/instance/settings', InstanceSettingsPage],
  ['Health', '/instance/health', HealthPage],
]

/** The "‹ Instance" button in the page's column (the breadcrumb has a link of the same name). */
const backLink = () =>
  page
    .getByRole('link', { name: 'Instance' })
    .elements()
    .find((el) => !el.closest('nav'))

describe.each(PAGES)('%s', (_name, route, Page) => {
  it('goes back to the Instance hub with "‹ Instance"', async () => {
    fakeApi(ROUTES)
    const { router } = await renderPage(<Page />, {
      route,
      announcer: true,
      otherRoutes: ['/instance/overview'],
    })
    await expect.poll(backLink).not.toBeUndefined()
    expect(backLink()).toHaveAttribute('href', '/instance/overview')
    await userEvent.click(backLink()!)
    await expect.poll(() => router.state.location.pathname).toBe('/instance/overview')
  })

  it('reads Instance in its breadcrumb, a link to the hub', async () => {
    fakeApi(ROUTES)
    await renderPage(<Page />, { route, announcer: true, otherRoutes: ['/instance/overview'] })
    await expect
      .element(
        page
          .getByRole('navigation', { name: 'Breadcrumb' })
          .getByRole('link', { name: 'Instance' }),
      )
      .toHaveAttribute('href', '/instance/overview')
  })

  it('shows no way back to someone who is not an instance admin', async () => {
    fakeApi({
      'GET /api/instance/accounts': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/settings': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/github-app': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/health/checks': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/health/queues': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/health/address-checklist': { status: 403, body: { error: 'Forbidden' } },
    })
    await renderPage(<Page />, { route, announcer: true, otherRoutes: ['/instance/overview'] })
    await expect.element(page.getByText('Instance admins only')).toBeVisible()
    expect(backLink()).toBeUndefined()
  })
})
