import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ProjectSettingsPage } from '../../../src/features/projects/ProjectSettingsPage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, hangingFetch, type ReplyHandler, restoreFetch } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

const settings = {
  name: 'Web App',
  defaultBranch: 'main',
  diffThreshold: 0.001,
  autoApproveDefaultBranch: false,
  blockMergeOnChanges: true,
  flakyBlocksMerge: null as boolean | null,
  retentionDays: 30,
  staticHostingEnabled: false,
}

const hook = (id: string, url: string, events = ['build.completed']) => ({
  id,
  url,
  events,
  enabled: true,
  createdAt: new Date().toISOString(),
})

function response(over: Record<string, unknown> = {}) {
  return {
    canManage: true,
    settings,
    org: { flakyBlocksMerge: true },
    webhooks: [],
    webhookEvents: ['build.completed', 'build.reviewed'],
    github: { configured: false, webhookUrl: 'https://circi.test/webhooks/github', link: null },
    sitesConfigured: false,
    ...over,
  }
}

const API = '/api/projects/acme/web'
const control = () => page.getByRole('combobox', { name: 'Flaky screenshots block merges' })

function api(over: Record<string, unknown> = {}, extra: Record<string, ReplyHandler> = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: { body: response(over) },
    [`PATCH ${API}/settings`]: { body: { settings } },
    ...extra,
  })
}

const github = (link: unknown) => ({
  configured: true,
  webhookUrl: 'https://circi.test/webhooks/github',
  link,
})

const show = () =>
  renderPage(<ProjectSettingsPage />, {
    route: '/$org/$project/settings',
    url: '/acme/web/settings',
    announcer: true,
  })
const heading = (name: string) => page.getByRole('heading', { name })

describe('ProjectSettingsPage', () => {
  it('shows its breadcrumb while loading and announces a slow load', async () => {
    hangingFetch()
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.poll(() => crumbs.element().textContent).toBe('ProjectsacmewebSettings')
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading settings', {
      timeout: 2_000,
    })
  })

  it('links the breadcrumb back to the project and shows its name once loaded', async () => {
    api()
    await show()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('href', '/acme/web')
    expect(document.title).toBe('Settings · web · CirCI')
  })

  it('fills the form from the saved settings, converting the threshold to a percentage', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Web App')
    await expect.element(page.getByRole('textbox', { name: 'Default branch' })).toHaveValue('main')
    await expect
      .element(page.getByRole('spinbutton', { name: 'Ignore differences below (% of pixels)' }))
      .toHaveValue(0.1)
    await expect
      .element(page.getByRole('spinbutton', { name: 'Keep builds for (days)' }))
      .toHaveValue(30)
    await expect
      .element(page.getByRole('checkbox', { name: 'Block merging until changes are approved' }))
      .toBeChecked()
    await expect
      .element(
        page.getByRole('checkbox', { name: 'Approve builds on the default branch automatically' }),
      )
      .not.toBeChecked()
    // No static hosting switch unless the instance can host sites.
    expect(page.getByRole('checkbox', { name: /Host static sites/ }).elements()).toHaveLength(0)
  })

  it('saves what was edited, announces it and shows a confirmation', async () => {
    const fake = api({ sitesConfigured: true })
    await show()
    await page.getByRole('textbox', { name: 'Name' }).fill('Web')
    await page
      .getByRole('spinbutton', { name: 'Ignore differences below (% of pixels)' })
      .fill('2.5')
    await page.getByRole('spinbutton', { name: 'Keep builds for (days)' }).fill('90')
    await page
      .getByRole('checkbox', { name: 'Approve builds on the default branch automatically' })
      .click()
    await page
      .getByRole('checkbox', { name: 'Host static sites (Storybook, reports) for this project' })
      .click()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect.element(page.getByText('Settings saved.')).toBeVisible()
    expect(fake.of('PATCH')).toEqual([
      {
        method: 'PATCH',
        path: `${API}/settings`,
        body: {
          name: 'Web',
          defaultBranch: 'main',
          diffThreshold: 0.025,
          retentionDays: 90,
          autoApproveDefaultBranch: true,
          blockMergeOnChanges: true,
          flakyBlocksMerge: null,
          staticHostingEnabled: true,
        },
      },
    ])
    await expect
      .element(page.getByRole('status').filter({ hasText: /^Settings saved$/ }))
      .toBeVisible()
  })

  describe('flaky screenshots block merges', () => {
    it('inherits the organization by default, and says what that currently means', async () => {
      api()
      await show()
      await expect.element(control()).toHaveTextContent('Inherit from organization (currently: on)')
    })

    it('shows the organization’s current value when it is off', async () => {
      api({ org: { flakyBlocksMerge: false } })
      await show()
      await expect
        .element(control())
        .toHaveTextContent('Inherit from organization (currently: off)')
    })

    it('shows an explicit value of its own', async () => {
      api({ settings: { ...settings, flakyBlocksMerge: false } })
      await show()
      await expect.element(control()).toHaveTextContent('Off')
    })

    it('saves an explicit choice, and null to inherit again', async () => {
      const fake = api()
      await show()
      await control().click()
      await page.getByRole('option', { name: 'Off' }).click()
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toMatchObject({ flakyBlocksMerge: false })

      await control().click()
      await page.getByRole('option', { name: 'On', exact: true }).click()
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toMatchObject({ flakyBlocksMerge: true })

      await control().click()
      await page.getByRole('option', { name: /^Inherit from organization/ }).click()
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(3)
      expect(fake.of('PATCH')[2]?.body).toMatchObject({ flakyBlocksMerge: null })
    })

    it('is read-only for members', async () => {
      api({ canManage: false })
      await show()
      await expect.element(control()).toBeDisabled()
    })
  })

  it('shows the server’s refusal when saving fails', async () => {
    const fake = api()
    fake.set(`PATCH ${API}/settings`, {
      status: 400,
      body: { error: 'Default branch is required' },
    })
    await show()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Default branch is required')
    expect(page.getByText('Settings saved.').elements()).toHaveLength(0)
  })

  it('lets members look but not change anything', async () => {
    api({ canManage: false, webhooks: [hook('h1', 'https://a.test/hook')] })
    await show()
    await expect
      .element(page.getByText('Only owners and admins can change these settings.'))
      .toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'Block merging until changes are approved' }))
      .toHaveAttribute('data-disabled')
    expect(page.getByRole('button', { name: 'Save settings' }).elements()).toHaveLength(0)
    expect(heading('CI token').elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Remove' }).elements()).toHaveLength(0)
    expect(page.getByRole('textbox', { name: 'Address' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('https://a.test/hook')).toBeVisible()
  })

  it('says the project doesn’t exist for a 404, and retries other errors', async () => {
    fakeApi({ [`GET ${API}/settings`]: { status: 404, body: { error: 'Project not found' } } })
    await show()
    await expect.element(heading('This project doesn’t exist')).toBeVisible()
  })

  it('shows other errors and retries', async () => {
    const fake = fakeApi({ [`GET ${API}/settings`]: { status: 500, body: { error: 'db down' } } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/settings`, { body: response() })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible()
  })

  describe('CI token', () => {
    it('replaces the token only after confirming, and shows the new one once', async () => {
      const fake = api(
        {},
        {
          [`POST ${API}/token`]: { body: { token: 'circi_new_token' } },
        },
      )
      await show()
      await expect.element(page.getByLabelText('Token hidden')).toBeVisible()
      await page.getByRole('button', { name: 'Replace token…' }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Replace the CI token?' })
      await expect.element(dialog).toBeVisible()
      // Cancelling changes nothing.
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect.element(dialog).not.toBeInTheDocument()
      expect(fake.of('POST')).toHaveLength(0)
      await page.getByRole('button', { name: 'Replace token…' }).click()
      await page.getByRole('button', { name: 'Replace token', exact: true }).click()
      await expect.element(page.getByText('circi_new_token')).toBeVisible()
      await expect.element(page.getByText(/update CIRCI_TOKEN in your CI secrets/)).toBeVisible()
      await expect.element(dialog).not.toBeInTheDocument()
      expect(fake.of('POST')).toHaveLength(1)
      await expect.element(page.getByRole('button', { name: 'Copy CI token' })).toBeVisible()
    })

    it('warns at the top while GitHub refuses the installation', async () => {
      api({
        github: github({
          installationId: '4242',
          repoRef: 'acme/web',
          attention: { reason: 'installation_revoked', since: new Date().toISOString() },
        }),
      })
      await show()
      const banner = page.getByRole('alert')
      await expect.element(banner.getByText(/reach GitHub for this project/)).toBeVisible()
      await expect.element(banner.getByText(/GitHub App was removed or suspended/)).toBeVisible()
      // The link is still shown and can be saved again, which clears the warning.
      await expect.element(page.getByRole('button', { name: 'Update link' })).toBeVisible()
    })

    it('shows no warning for a healthy link', async () => {
      api({ github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }) })
      await show()
      await expect.element(page.getByText(/Reporting to/)).toBeVisible()
      expect(page.getByRole('alert').elements()).toHaveLength(0)
    })

    it('shows the server’s refusal', async () => {
      api(
        {},
        {
          [`POST ${API}/token`]: { status: 500, body: { error: 'could not issue a token' } },
        },
      )
      await show()
      await page.getByRole('button', { name: 'Replace token…' }).click()
      await page.getByRole('button', { name: 'Replace token', exact: true }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('could not issue a token')
    })
  })

  describe('GitHub', () => {
    it('is left out when the instance has no GitHub App', async () => {
      api()
      await show()
      await expect.element(heading('CI token')).toBeVisible()
      expect(heading('GitHub').elements()).toHaveLength(0)
    })

    it('links a repository', async () => {
      const fake = api(
        { github: github(null) },
        {
          [`PUT ${API}/github`]: { body: { link: {} } },
        },
      )
      await show()
      await expect.element(page.getByText('https://circi.test/webhooks/github')).toBeVisible()
      expect(page.getByRole('button', { name: 'Unlink' }).elements()).toHaveLength(0)
      await page.getByRole('textbox', { name: 'Repository' }).fill(' acme/web ')
      await page.getByRole('textbox', { name: 'GitHub App installation id' }).fill('4242')
      await page.getByRole('button', { name: 'Link repository' }).click()
      await expect.poll(() => fake.of('PUT')).toHaveLength(1)
      expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'acme/web', installationId: '4242' })
    })

    it('shows the current link, updates it and unlinks it', async () => {
      const fake = api(
        { github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }) },
        {
          [`PUT ${API}/github`]: { body: { link: {} } },
          [`DELETE ${API}/github`]: { status: 204 },
        },
      )
      await show()
      await expect.element(page.getByText(/Reporting to/)).toBeVisible()
      await expect
        .element(page.getByRole('textbox', { name: 'Repository' }))
        .toHaveValue('acme/web')
      await page.getByRole('button', { name: 'Update link' }).click()
      await expect.poll(() => fake.of('PUT')).toHaveLength(1)
      await page.getByRole('button', { name: 'Unlink' }).click()
      await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
    })

    it('shows the server’s refusal', async () => {
      api(
        { github: github(null) },
        {
          [`PUT ${API}/github`]: { status: 400, body: { error: 'Unknown installation' } },
        },
      )
      await show()
      await page.getByRole('textbox', { name: 'Repository' }).fill('acme/web')
      await page.getByRole('textbox', { name: 'GitHub App installation id' }).fill('1')
      await page.getByRole('button', { name: 'Link repository' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Unknown installation')
    })

    it('is read-only for members', async () => {
      api({
        canManage: false,
        github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }),
      })
      await show()
      await expect.element(page.getByText(/Reporting to/)).toBeVisible()
      expect(page.getByRole('button', { name: 'Unlink' }).elements()).toHaveLength(0)
    })
  })

  describe('webhooks', () => {
    it('says when there are none', async () => {
      api()
      await show()
      await expect.element(page.getByText('No webhooks yet')).toBeVisible()
      await expect
        .element(
          page.getByText(
            'Get a signed POST to your own service when a build finishes or is reviewed.',
          ),
        )
        .toBeVisible()
    })

    it('lists each webhook with its address, events and age', async () => {
      api({
        webhooks: [
          hook('h1', 'https://a.test/hook', ['build.completed', 'build.reviewed']),
          hook('h2', 'https://b.test/hook'),
        ],
      })
      await show()
      const rows = page.getByRole('list', { name: 'Webhooks' })
      await expect.element(rows.getByText('https://a.test/hook')).toBeVisible()
      await expect.element(rows.getByText('https://b.test/hook')).toBeVisible()
      await expect
        .element(rows.getByRole('list', { name: 'Events' }).first().getByText('build.reviewed'))
        .toBeVisible()
      expect(page.getByRole('button', { name: 'Remove' }).elements()).toHaveLength(2)
    })

    it('adds one for the picked events and shows its signing secret once', async () => {
      const fake = api(
        {},
        {
          [`POST ${API}/webhooks`]: {
            body: { webhook: hook('h9', 'https://new.test/hook'), secret: 'whsec_abc' },
          },
        },
      )
      await show()
      await page.getByRole('textbox', { name: 'Address' }).fill(' https://new.test/hook ')
      await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
      await page.getByRole('button', { name: 'Add webhook' }).click()
      await expect.element(page.getByText('Signing secret for https://new.test/hook')).toBeVisible()
      await expect.element(page.getByText('whsec_abc')).toBeVisible()
      expect(fake.of('POST')).toEqual([
        {
          method: 'POST',
          path: `${API}/webhooks`,
          body: { url: 'https://new.test/hook', events: ['build.completed'] },
        },
      ])
      // The address field is cleared, and the notice can be dismissed.
      await expect.element(page.getByRole('textbox', { name: 'Address' })).toHaveValue('')
      await page.getByRole('button', { name: 'Dismiss' }).click()
      await expect.element(page.getByText('whsec_abc')).not.toBeInTheDocument()
    })

    it('asks for an address', async () => {
      const fake = api()
      await show()
      await page.getByRole('button', { name: 'Add webhook' }).click()
      await expect.element(page.getByText('Enter an address')).toBeVisible()
      expect(fake.of('POST')).toHaveLength(0)
    })

    it('won’t add without an event: says so next to the events, and sends nothing', async () => {
      const fake = api()
      await show()
      await page.getByRole('textbox', { name: 'Address' }).fill('https://new.test/hook')
      await page.getByRole('checkbox', { name: 'build.completed' }).click()
      await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
      await page.getByRole('button', { name: 'Add webhook' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Choose at least one event')
      expect(fake.of('POST')).toHaveLength(0)
      // Picking an event clears the error, and the webhook can be added.
      fake.set(`POST ${API}/webhooks`, {
        body: { webhook: hook('h9', 'https://new.test/hook'), secret: 'whsec_abc' },
      })
      await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
      await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
      await page.getByRole('button', { name: 'Add webhook' }).click()
      await expect.poll(() => fake.of('POST')).toHaveLength(1)
      expect(fake.of('POST')[0]?.body).toEqual({
        url: 'https://new.test/hook',
        events: ['build.reviewed'],
      })
    })

    it('shows the server’s refusal of an address', async () => {
      api(
        {},
        {
          [`POST ${API}/webhooks`]: { status: 400, body: { error: 'Address must be public' } },
        },
      )
      await show()
      await page.getByRole('textbox', { name: 'Address' }).fill('http://localhost/x')
      await page.getByRole('button', { name: 'Add webhook' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Address must be public')
    })

    it('removes one only after confirming, naming it', async () => {
      const fake = api(
        { webhooks: [hook('h1', 'https://a.test/hook'), hook('h2', 'https://b.test/hook')] },
        { [`DELETE ${API}/webhooks/h2`]: { status: 204 } },
      )
      await show()
      await page.getByRole('button', { name: 'Remove' }).nth(1).click()
      const dialog = page.getByRole('alertdialog', { name: 'Remove webhook?' })
      await expect.element(dialog).toBeVisible()
      await expect
        .element(dialog)
        .toHaveAccessibleDescription(/https:\/\/b\.test\/hook stops receiving build events/)
      await page.getByRole('button', { name: 'Cancel' }).click()
      expect(fake.of('DELETE')).toHaveLength(0)
      await page.getByRole('button', { name: 'Remove' }).nth(1).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
      await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
      await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
      await expect
        .element(page.getByRole('status').filter({ hasText: /^Webhook removed$/ }))
        .toBeVisible()
    })
  })
})
