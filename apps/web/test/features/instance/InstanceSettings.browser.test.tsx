import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { InstanceSettingsPage } from '#features/instance/InstanceSettingsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { settingsFixture } from './fixtures.ts'

const show = () => renderPage(<InstanceSettingsPage />, { route: '/instance/settings' })

const GITHUB = {
  'GET /api/instance/github-app': {
    body: {
      source: 'none',
      canManage: true,
      appId: null,
      slug: null,
      htmlUrl: null,
      warning: null,
      blocked: null,
      defaultName: 'CirCI',
    },
  },
}

describe('instance settings', () => {
  it('shows what the environment says, and which variable sets it', async () => {
    fakeApi({ 'GET /api/instance/settings': { body: settingsFixture() }, ...GITHUB })
    await show()
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'Instance settings' }))
      .toBeVisible()
    await expect.element(page.getByText('https://ci.acme.io')).toBeVisible()
    await expect.element(page.getByText('PUBLIC_URL', { exact: true })).toBeVisible()
    await expect.element(page.getByText('smtp.acme.io:587')).toBeVisible()
    await expect.element(page.getByText('AUTH_PASSWORD_ENABLED')).toBeVisible()
    expect(document.body.textContent).not.toContain('you can check them here')
    // The page's name is the header's one h1, not repeated as a title above the sections.
    expect(
      page
        .getByRole('heading', { level: 1 })
        .elements()
        .map((el) => el.textContent),
    ).toEqual(['Instance settings'])
    expect(page.getByRole('heading', { name: 'Instance settings' }).elements()).toHaveLength(1)
    // The GitHub App is a section of this page.
    await expect.element(page.getByRole('button', { name: 'Create GitHub App' })).toBeVisible()
  })

  it('says who can create workspaces, and which variable sets it', async () => {
    fakeApi({ 'GET /api/instance/settings': { body: settingsFixture() }, ...GITHUB })
    await show()
    const section = page.getByRole('region', { name: 'Who can create workspaces' })
    await expect.element(section.getByText('Instance admins only')).toBeVisible()
    await expect.element(section.getByText(/Set WORKSPACE_CREATION=anyone/)).toBeVisible()
    await expect.element(section.getByText('WORKSPACE_CREATION', { exact: true })).toBeVisible()
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({
      'GET /api/instance/settings': { status: 403, body: { error: 'Forbidden' } },
      ...GITHUB,
    })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })

  it('offers to retry when the settings are not available', async () => {
    fakeApi({
      'GET /api/instance/settings': {
        status: 501,
        body: { error: 'Instance settings are not available' },
      },
    })
    await show()
    await expect.element(page.getByText('Instance settings are not available')).toBeVisible()
  })

  it('sends a test mail and shows that it was sent', async () => {
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/mail/test': {
        body: {
          ok: true,
          to: 'michael@acme.dev',
          message: 'Sent a test mail to michael@acme.dev.',
        },
      },
      ...GITHUB,
    })
    await show()
    await page.getByRole('button', { name: 'Send test mail' }).click()
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('Sent a test mail to michael@acme.dev.')
    expect(fake.of('POST')).toHaveLength(1)
  })

  it('shows why a test mail failed', async () => {
    fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/mail/test': {
        body: {
          ok: false,
          to: 'michael@acme.dev',
          message: "Couldn't send the test mail: ECONNREFUSED",
        },
      },
      ...GITHUB,
    })
    await show()
    await page.getByRole('button', { name: 'Send test mail' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent("Couldn't send the test mail: ECONNREFUSED")
  })

  it('says mail is not configured', async () => {
    fakeApi({
      'GET /api/instance/settings': {
        body: settingsFixture({
          mail: {
            configured: false,
            from: null,
            host: null,
            port: null,
            secure: null,
            authenticated: false,
          },
        }),
      },
      ...GITHUB,
    })
    await show()
    await expect.element(page.getByText("Mail isn't configured")).toBeVisible()
  })
})
