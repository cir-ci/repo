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
    await expect.element(page.getByText('Set in the environment').first()).toBeVisible()
    // The GitHub App is a section of this page.
    await expect.element(page.getByRole('button', { name: 'Create GitHub App' })).toBeVisible()
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
          message: 'Could not send the test mail: ECONNREFUSED',
        },
      },
      ...GITHUB,
    })
    await show()
    await page.getByRole('button', { name: 'Send test mail' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not send the test mail: ECONNREFUSED')
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
    await expect.element(page.getByText('Mail is not configured')).toBeVisible()
  })
})
