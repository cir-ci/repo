import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { GithubSetupPage } from '#features/instance/GithubSetupPage.tsx'
import { renderPage } from '#test/support/render.tsx'

const capabilities = (manageable: { slug: string; name: string }[]) => ({
  body: {
    canCreateWorkspace: false,
    instanceAdmin: false,
    manageableWorkspaces: manageable,
    refusingWorkspaces: [],
    mailConfigured: false,
  },
})

const show = (
  manageable: { slug: string; name: string }[],
  url = '/integrations/github/setup?installation_id=inst-4242',
  extra: Parameters<typeof renderPage>[1] = {},
) =>
  renderPage(<GithubSetupPage />, {
    route: '/integrations/$kind/setup',
    url,
    api: { 'GET /api/capabilities': capabilities(manageable) },
    ...extra,
  })

const acme = { slug: 'acme', name: 'Acme' }
const globex = { slug: 'globex', name: 'Globex' }

describe('GithubSetupPage', () => {
  it('asks which workspace the installation belongs to, one button per workspace', async () => {
    await show([acme, globex])
    await expect
      .element(page.getByText('Choose the workspace this GitHub installation belongs to.'))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Acme' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Globex' })).toBeVisible()
  })

  it('connects the installation to the chosen workspace and opens the new integration', async () => {
    const { router, calls } = await show([acme, globex], undefined, {
      api: {
        'GET /api/capabilities': capabilities([acme, globex]),
        'POST /api/workspaces/globex/integrations/github/connect': {
          status: 201,
          body: { id: 'i9' },
        },
      },
    })
    await page.getByRole('button', { name: 'Globex' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ installationId: 'inst-4242' })
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/globex/settings/integrations/github/i9')
  })

  it('shows the refusal under the workspace that refused', async () => {
    await show([acme], undefined, {
      api: {
        'GET /api/capabilities': capabilities([acme]),
        'POST /api/workspaces/acme/integrations/github/connect': {
          status: 409,
          body: { error: 'That installation is already connected' },
        },
      },
    })
    await page.getByRole('button', { name: 'Acme' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('That installation is already connected')
  })

  // Known bug: GitHub's installation ids are numbers, and the router parses `?installation_id=4242`
  // into the number 4242, which the page then treats as "not given". Remove `.fails` with the fix.
  it('accepts the numeric installation id GitHub sends', async () => {
    await show([acme], '/integrations/github/setup?installation_id=4242')
    await expect
      .element(page.getByRole('button', { name: 'Acme' }), { timeout: 1500 })
      .toBeVisible()
  })

  it('says so when GitHub did not name an installation', async () => {
    await show([acme], '/integrations/github/setup')
    await expect
      .element(page.getByText('GitHub didn’t say which installation to connect.'))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Acme' }).elements()).toHaveLength(0)
  })

  it('tells people who manage no workspace that only owners and admins can connect', async () => {
    await show([])
    await expect
      .element(page.getByText('Only workspace owners and admins can connect GitHub.'))
      .toBeVisible()
  })

  it('shows the error with a way to retry when the capabilities fail to load', async () => {
    await show([], undefined, {
      api: { 'GET /api/capabilities': { status: 500, body: { error: 'Database is down' } } },
    })
    await expect.element(page.getByText('This page couldn’t be loaded')).toBeVisible()
    await expect.element(page.getByText('Database is down')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
