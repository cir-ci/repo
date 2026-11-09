import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { SignInPage } from '#features/workspace-settings/SignInPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const ROUTE = {
  route: '/workspaces/$workspace/settings/sign-in',
  url: '/workspaces/acme/settings/sign-in',
}
const routes = (canManage: boolean) => ({
  'GET /api/workspaces/acme': { body: { canManage, name: 'Acme Inc', slug: 'acme' } },
  'GET /api/workspaces/acme/auth': {
    body: {
      canManage,
      settings: { passwordLoginEnabled: true, emailLoginEnabled: false },
      instance: { password: true, email: true },
    },
  },
  'GET /api/workspaces/acme/domains': { body: { domains: [] } },
  'GET /api/workspaces/acme/sso': { body: { providers: [] } },
})

describe('SignInPage', () => {
  it('puts sign-in methods, single sign-on and email domains on one page for admins', async () => {
    await page.viewport(1000, 1000)
    fakeApi(routes(true))
    await renderPage(<SignInPage />, ROUTE)
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await Promise.all(
      ['Sign-in methods', 'Single sign-on', 'Email domains'].map(async (name) => {
        await expect.element(page.getByRole('heading', { name })).toBeVisible()
      }),
    )
    await expect.element(page.getByRole('switch', { name: /Password/ })).toBeChecked()
  })

  it('shows members the methods read-only and hides domains and single sign-on', async () => {
    await page.viewport(1000, 1000)
    fakeApi(routes(false))
    await renderPage(<SignInPage />, ROUTE)
    await expect.element(page.getByRole('switch', { name: /Password/ })).toBeDisabled()
    await expect
      .element(page.getByText(/Only owners and admins can change sign-in settings/))
      .toBeVisible()
    expect(page.getByRole('heading', { name: 'Email domains' }).elements()).toHaveLength(0)
    expect(page.getByRole('heading', { name: 'Single sign-on' }).elements()).toHaveLength(0)
  })

  it('says the workspace doesn’t exist for a 404', async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      'GET /api/workspaces/acme': { status: 404, body: { error: 'Workspace not found' } },
      'GET /api/workspaces/acme/auth': { status: 404, body: { error: 'Workspace not found' } },
    })
    await renderPage(<SignInPage />, ROUTE)
    await expect.element(page.getByText('This workspace doesn’t exist')).toBeVisible()
  })
})
