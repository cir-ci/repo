import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { formPost } from '#features/instance/api/github-app.ts'
import { InstanceSettingsPage } from '#features/instance/InstanceSettingsPage.tsx'
import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { navigation } from '#features/integrations/api/generic.ts'
import { settingsFixture } from '#test/features/instance/fixtures.ts'
import { entry } from '#test/features/integrations/fixtures.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

const SETTINGS = settingsFixture()

const APP = {
  source: 'none',
  canManage: true,
  appId: null,
  slug: null,
  htmlUrl: null,
  warning: null,
  blocked: null,
  defaultName: 'CirCI (ci.acme.io)',
}

const showInstance = (url = '/instance/settings') =>
  renderPage(<InstanceSettingsPage />, { route: '/instance/settings', url })

/** The page also reads the effective settings; the GitHub App section is what these tests are about. */
const fakeInstance = (routes: Parameters<typeof fakeApi>[0]) =>
  fakeApi({ 'GET /api/instance/settings': { body: SETTINGS }, ...routes })

describe('the GitHub App section of Instance settings', () => {
  it('creates the App: posts the manifest it was given to GitHub with its state', async () => {
    const submit = vi.spyOn(formPost, 'submit').mockImplementation(() => {})
    const fake = fakeInstance({
      'GET /api/instance/github-app': { body: APP },
      'POST /api/instance/github-app/manifest': {
        body: {
          manifest: { name: 'CirCI at Acme' },
          postUrl: 'https://github.com/organizations/acme/settings/apps/new',
          state: 'signed-state',
        },
      },
    })
    await showInstance()
    await expect.element(page.getByLabelText('App name')).toHaveValue('CirCI (ci.acme.io)')
    await page.getByLabelText('App name').fill('CirCI at Acme')
    await page.getByLabelText('GitHub organization (leave empty for your account)').fill('acme')
    await page.getByRole('button', { name: 'Create GitHub App' }).click()
    await expect.poll(() => submit.mock.calls).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ name: 'CirCI at Acme', organization: 'acme' })
    expect(submit).toHaveBeenCalledWith('https://github.com/organizations/acme/settings/apps/new', {
      manifest: '{"name":"CirCI at Acme"}',
      state: 'signed-state',
    })
  })

  it('warns about an address GitHub cannot reach, but still lets it be tried', async () => {
    fakeInstance({
      'GET /api/instance/github-app': {
        body: { ...APP, warning: 'GitHub can’t deliver webhooks to localhost.' },
      },
    })
    await showInstance()
    await expect
      .element(page.getByText('GitHub can’t deliver webhooks to localhost.'))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Create GitHub App' })).toBeEnabled()
  })

  it('blocks an insecure address', async () => {
    fakeInstance({
      'GET /api/instance/github-app': {
        body: { ...APP, blocked: 'GitHub only delivers to https.' },
      },
    })
    await showInstance()
    await expect.element(page.getByText('GitHub only delivers to https.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Create GitHub App' })).toBeDisabled()
  })

  it('shows an App from the environment read-only, with no button to create one', async () => {
    fakeInstance({
      'GET /api/instance/github-app': {
        body: {
          ...APP,
          source: 'env',
          appId: '77',
          slug: 'env-app',
          htmlUrl: 'https://github.com/apps/env-app',
        },
      },
    })
    await showInstance()
    await expect.element(page.getByText(/Configured by the server’s environment/)).toBeVisible()
    await expect.element(page.getByText('77')).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'env-app' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Create GitHub App' }))
      .not.toBeInTheDocument()
  })

  it('says an App created here is stored, and offers a non-admin no way to create one', async () => {
    fakeInstance({
      'GET /api/instance/github-app': {
        body: { ...APP, source: 'manifest', appId: '9', slug: 'circi', canManage: false },
      },
    })
    await showInstance()
    await expect.element(page.getByText(/Created from this page/)).toBeVisible()
    expect(page.getByRole('button', { name: 'Create GitHub App' }).elements()).toHaveLength(0)
  })

  it('explains a setup GitHub did not finish', async () => {
    fakeInstance({ 'GET /api/instance/github-app': { body: APP } })
    await showInstance('/instance/settings?githubApp=failed')
    await expect.element(page.getByText(/didn’t finish creating the App/)).toBeVisible()
  })
})

describe('the Add dialog’s GitHub tile', () => {
  const github = entry({
    kind: 'github',
    name: 'GitHub',
    connectable: false,
    credentials: [
      {
        name: 'installationId',
        label: 'GitHub App installation ID',
        secret: false,
        optional: false,
      },
    ],
  })
  const open = () =>
    renderPage(
      <AddIntegrationDialog
        workspace="acme"
        open
        onOpenChange={() => {}}
        catalog={[github]}
        added={[]}
      />,
    )

  it('goes straight to "Install on GitHub" when the instance has an App', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      'GET /api/instance/github-app': { body: { ...APP, source: 'manifest', canManage: false } },
      'GET /api/workspaces/acme/integrations/github/install': {
        body: { url: 'https://github.com/apps/circi/installations/new?state=s' },
      },
    })
    await open()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    await page.getByRole('button', { name: 'Install on GitHub' }).click()
    await expect
      .poll(() => assign.mock.calls[0]?.[0])
      .toBe('https://github.com/apps/circi/installations/new?state=s')
    // The old form stays behind "Advanced".
    await expect
      .element(page.getByRole('textbox', { name: 'GitHub App installation ID' }))
      .not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Advanced: connect by installation ID' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'GitHub App installation ID' }))
      .toBeVisible()
  })

  it('sends an instance admin to the instance page when there is no App', async () => {
    fakeApi({ 'GET /api/instance/github-app': { body: APP } })
    await open()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    await expect
      .element(page.getByRole('link', { name: 'Set up the GitHub App' }))
      .toHaveAttribute('href', '/instance/settings')
    await expect
      .element(page.getByRole('button', { name: 'Install on GitHub' }))
      .not.toBeInTheDocument()
  })

  it('tells anyone else that an administrator must set it up', async () => {
    fakeApi({ 'GET /api/instance/github-app': { body: { ...APP, canManage: false } } })
    await open()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    await expect
      .element(
        page.getByText('An administrator of this instance must set up the GitHub App first.'),
      )
      .toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Set up the GitHub App' }))
      .not.toBeInTheDocument()
  })
})

describe('formPost', () => {
  it('submits a hidden form with the fields to the address', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    formPost.submit('https://github.com/settings/apps/new', { manifest: '{"a":1}', state: 's' })
    expect(submit).toHaveBeenCalledOnce()
    const form = document.querySelector<HTMLFormElement>(
      'form[action="https://github.com/settings/apps/new"]',
    )
    expect(form?.method).toBe('post')
    expect(form?.hidden).toBe(true)
    expect(Object.fromEntries(new FormData(form ?? undefined))).toEqual({
      manifest: '{"a":1}',
      state: 's',
    })
    form?.remove()
  })
})
