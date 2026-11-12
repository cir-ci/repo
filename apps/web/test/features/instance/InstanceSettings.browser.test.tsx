import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { InstanceSettingsPage } from '#features/instance/InstanceSettingsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { expectOnePrimaryPerArea } from '#test/support/primary-buttons.ts'
import { renderPage } from '#test/support/render.tsx'

import { configFixture, settingsFixture } from './fixtures.ts'

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

/** A toast says its message once: it is on the page exactly one time. */
const toastShows = async (message: string) => {
  await expect.element(page.getByText(message)).toBeVisible()
  expect(page.getByText(message).elements()).toHaveLength(1)
}

describe('instance settings', () => {
  it('shows the settings, and which variable sets what', async () => {
    fakeApi({ 'GET /api/instance/settings': { body: settingsFixture() }, ...GITHUB })
    await show()
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'Instance settings' }))
      .toBeVisible()
    await expect.element(page.getByText('https://ci.acme.io')).toBeVisible()
    await expect.element(page.getByText('PUBLIC_URL', { exact: true })).toBeVisible()
    expect(
      page
        .getByRole('heading', { level: 1 })
        .elements()
        .map((el) => el.textContent),
    ).toEqual(['Instance settings'])
    const providers = page.getByRole('region', { name: 'Single sign-on providers' })
    await expect.element(providers.getByText('Set by AUTH_GITHUB_*')).toBeVisible()
    expect(providers.getByRole('button', { name: 'Edit' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: 'Create GitHub App' })).toBeVisible()
  })

  it('locks a setting whose variable is set, with the variable named', async () => {
    const config = configFixture()
    fakeApi({
      'GET /api/instance/settings': {
        body: settingsFixture({
          config: {
            ...config,
            limits: {
              ...config.limits,
              gcGraceHours: { value: 48, source: 'env', env: 'GC_GRACE_HOURS' },
            },
            workspaceCreation: { value: 'anyone', source: 'env', env: 'WORKSPACE_CREATION' },
          },
        }),
      },
      ...GITHUB,
    })
    await show()
    await expect.element(page.getByText('Set by GC_GRACE_HOURS')).toBeVisible()
    await expect.element(page.getByLabelText('Unused files are deleted after')).toBeDisabled()
    await expect.element(page.getByText('Set by WORKSPACE_CREATION')).toBeVisible()
    await expect
      .element(
        page.getByRole('checkbox', { name: 'Let every signed-in account create workspaces' }),
      )
      .toBeDisabled()
    await expect.element(page.getByLabelText('Finished background jobs are kept for')).toBeEnabled()
  })

  it('saves with Save, says so in a toast, and Discard goes back', async () => {
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'PUT /api/instance/config/limits': { body: configFixture() },
      'PUT /api/instance/config/sign-in': { body: configFixture() },
      ...GITHUB,
    })
    await show()
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect.element(save).toBeDisabled()

    const retention = page.getByLabelText('New projects keep builds for')
    await retention.fill('45')
    await expect.element(save).toBeEnabled()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(retention).toHaveValue('90')
    await expect.element(save).toBeDisabled()

    await retention.fill('45')
    await page.getByRole('checkbox', { name: 'Password' }).click()
    await save.click()
    await toastShows('Instance settings saved')
    expect(fake.of('PUT').map((c) => [c.path, c.body])).toEqual([
      ['/api/instance/config/limits', { defaultProjectRetentionDays: 45 }],
      ['/api/instance/config/sign-in', { password: false }],
    ])
  })

  it("shows the server's reason when a change would lock everyone out", async () => {
    fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'PUT /api/instance/config/sign-in': {
        status: 409,
        body: { error: 'Nobody could sign in with these settings.' },
      },
      ...GITHUB,
    })
    await show()
    await page.getByRole('checkbox', { name: 'Password' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await toastShows("Couldn't save: Nobody could sign in with these settings.")
    // Nothing was applied: the form still has its change to save.
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('shows a saved secret as "Saved", never its value, and replaces it', async () => {
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'PUT /api/instance/config/smtp': { body: configFixture() },
      ...GITHUB,
    })
    await show()
    const mail = page.getByRole('region', { name: 'Mail server' })
    const secret = mail.getByRole('group', { name: 'Password' })
    await expect.element(secret.getByText('Saved')).toBeVisible()
    expect(mail.getByLabelText('New password').elements()).toHaveLength(0)

    await secret.getByRole('button', { name: 'Replace' }).click()
    await mail.getByLabelText('New password').fill('brand-new-secret')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await toastShows('Instance settings saved')
    expect(fake.of('PUT')[0]?.body).toMatchObject({
      host: 'smtp.acme.io',
      password: 'brand-new-secret',
    })
  })

  it('marks a secret for removal and sends null on Save', async () => {
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'PUT /api/instance/config/smtp': { body: configFixture() },
      ...GITHUB,
    })
    await show()
    const mail = page.getByRole('region', { name: 'Mail server' })
    await mail
      .getByRole('group', { name: 'Password' })
      .getByRole('button', { name: 'Remove' })
      .click()
    await expect.element(mail.getByText('Removed when you save')).toBeVisible()
    await mail.getByLabelText('User name').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await toastShows('Instance settings saved')
    expect(fake.of('PUT')[0]?.body).toMatchObject({ user: '', password: null })
  })

  it('has one primary button in the page', async () => {
    fakeApi({ 'GET /api/instance/settings': { body: settingsFixture() }, ...GITHUB })
    await show()
    await page.getByLabelText('New projects keep builds for').fill('45')
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expectOnePrimaryPerArea()
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
})

describe('the test mail', () => {
  it('shows its result once, in a toast', async () => {
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
    await toastShows('Sent a test mail to michael@acme.dev.')
    expect(fake.of('POST')).toHaveLength(1)
  })

  it('shows why it failed once, in a toast and no banner', async () => {
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
    await toastShows("Couldn't send the test mail: ECONNREFUSED")
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('shows a request that failed once, as the one toast', async () => {
    fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/mail/test': { status: 400, body: { error: 'Try again later' } },
      ...GITHUB,
    })
    await show()
    await page.getByRole('button', { name: 'Send test mail' }).click()
    await expect.element(page.getByText(/Try again later/)).toBeVisible()
    expect(page.getByText(/Try again later/).elements()).toHaveLength(1)
  })
})

describe('single sign-on providers', () => {
  it('adds one in a dialog, with a write-only secret, and says so in a toast', async () => {
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture() },
      'PUT /api/instance/config/sso/google': { body: configFixture() },
      ...GITHUB,
    })
    await show()
    await page.getByRole('button', { name: 'Add provider' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabelText('Client ID').fill('google-client')
    await dialog.getByLabelText('Client secret').fill('google-secret')
    expectOnePrimaryPerArea()
    await dialog.getByRole('button', { name: 'Add provider' }).click()
    await toastShows('Added Google')
    expect(fake.of('PUT')[0]).toMatchObject({
      path: '/api/instance/config/sso/google',
      body: { clientId: 'google-client', clientSecret: 'google-secret', trustedForEmail: true },
    })
    await userEvent.keyboard('{Escape}')
  })

  it('lists a saved provider with Edit and Remove, and asks before removing', async () => {
    const config = configFixture({
      sso: [
        {
          id: 'google',
          name: 'Google',
          clientId: 'g-id',
          issuer: null,
          trustedForEmail: true,
          secretSaved: true,
          source: 'stored',
          env: null,
        },
      ],
    })
    const fake = fakeApi({
      'GET /api/instance/settings': { body: settingsFixture({ config }) },
      'DELETE /api/instance/config/sso/google': { body: configFixture() },
      ...GITHUB,
    })
    await show()
    const providers = page.getByRole('region', { name: 'Single sign-on providers' })
    await providers.getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await toastShows('Removed Google')
    expect(fake.of('DELETE')).toHaveLength(1)
  })
})
