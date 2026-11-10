import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamSettingsPage } from '#features/team-settings/TeamSettingsPage.tsx'
import { fakeApi, hangingFetch, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const settings = {
  name: 'Web App',
  slug: 'web',
  defaultBranch: 'main',
  diffThreshold: 0.001,
  autoApproveDefaultBranch: false,
  blockMergeOnChanges: true,
  flakyBlocksMerge: null as boolean | null,
  retentionDays: 30,
  reviewTargetHours: 24 as number | null,
  staticHostingEnabled: false,
}

function response(over: Record<string, unknown> = {}) {
  return {
    canManage: true,
    settings,
    appearance: { color: 'slate', icon: null },
    workspace: { flakyBlocksMerge: true },
    webhooks: [],
    webhookEvents: ['build.completed', 'build.reviewed'],
    github: { configured: false, webhookUrl: 'https://circi.test/webhooks/github', link: null },
    sitesConfigured: false,
    ...over,
  }
}

const API = '/api/teams/acme/web'
const control = () => page.getByRole('combobox', { name: /^Flaky-only changes block merging/ })

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
  renderPage(<TeamSettingsPage />, {
    route: '/$workspace/$team/settings',
    url: '/acme/web/settings',
    announcer: true,
    otherRoutes: ['/$workspace/$team'],
  })
const heading = (name: string) => page.getByRole('heading', { name })

async function openDelete() {
  await page.getByRole('button', { name: 'Delete team' }).click()
  return page.getByRole('dialog', { name: 'Delete Web App?' })
}

describe('TeamSettingsPage', () => {
  it('shows its breadcrumb while loading and announces a slow load', async () => {
    hangingFetch()
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.poll(() => crumbs.element().textContent).toBe('acmewebSettingsGeneral')
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading general')
  })

  it("links the breadcrumb to the team's Builds page and shows its name once loaded", async () => {
    api()
    await show()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('href', '/acme/web')
    await expect
      .element(page.getByRole('link', { name: 'Settings' }))
      .toHaveAttribute('href', '/acme/web/settings')
    expect(document.title).toBe('General · web · CirCI')
  })

  it('fills the form from the saved settings, converting the threshold to a percentage', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Web App')
    await expect.element(page.getByRole('textbox', { name: 'Default branch' })).toHaveValue('main')
    await expect.element(page.getByRole('textbox', { name: 'Diff threshold' })).toHaveValue('0.1')
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('30')
    await expect.element(page.getByRole('textbox', { name: 'Slug' })).toHaveValue('web')
    await expect
      .element(page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }))
      .toBeChecked()
    await expect
      .element(page.getByRole('checkbox', { name: /^Approve default-branch builds automatically/ }))
      .not.toBeChecked()
    // Nothing in the Save form is a switch: switches are for settings that apply at once.
    expect(page.getByRole('switch').elements()).toHaveLength(0)
    // No static hosting checkbox (and no section) unless the instance can host sites.
    expect(page.getByRole('checkbox', { name: /Host static sites/ }).elements()).toHaveLength(0)
    expect(page.getByRole('heading', { name: 'Hosted sites' }).elements()).toHaveLength(0)
  })

  it("opens with the board's lead and labels", async () => {
    api()
    await show()
    await expect.element(page.getByText(/more than this share of its pixels differ/)).toBeVisible()
    await expect.element(page.getByText('Keep builds for', { exact: true })).toBeVisible()
  })

  it('renames the slug and moves to the new address, warning first', async () => {
    const fake = api(
      {},
      { [`PATCH ${API}/settings`]: { body: { settings: { ...settings, slug: 'web-app' } } } },
    )
    const { router } = await show()
    await expect.element(page.getByRole('textbox', { name: 'Slug' })).toHaveValue('web')
    await page.getByRole('textbox', { name: 'Slug' }).fill('web-app')
    await expect.element(page.getByText(/stop working/)).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    expect(fake.of('PATCH')[0]?.body).toMatchObject({ slug: 'web-app' })
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings')
  })

  it('follows a slug rename in the settings nav: the remembered team and the sidebar', async () => {
    localStorage.setItem('circi-settings-team:acme', 'web')
    api(
      {},
      {
        [`PATCH ${API}/settings`]: { body: { settings: { ...settings, slug: 'web-app' } } },
        'GET /api/workspaces/acme/sidebar': { body: { teams: [], views: [], inboxUnread: 0 } },
      },
    )
    const { queryClient } = await show()
    // The settings nav has read the sidebar of the workspace: a rename makes it stale.
    await queryClient.fetchQuery({
      queryKey: ['sidebar', 'acme'],
      queryFn: () => fetch('/api/workspaces/acme/sidebar').then((r) => r.json()),
    })
    expect(queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated).toBe(false)
    await expect.element(page.getByRole('textbox', { name: 'Slug' })).toHaveValue('web')
    await page.getByRole('textbox', { name: 'Slug' }).fill('web-app')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => localStorage.getItem('circi-settings-team:acme')).toBe('web-app')
    await expect
      .poll(() => queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated)
      .toBe(true)
  })

  it("shows the server's refusal of a taken slug and stays put", async () => {
    api(
      {},
      {
        [`PATCH ${API}/settings`]: {
          status: 409,
          body: { error: 'The address "taken" is already taken' },
        },
      },
    )
    const { router } = await show()
    await page.getByRole('textbox', { name: 'Slug' }).fill('taken')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByText(/is already taken/)).toBeVisible()
    expect(router.state.location.pathname).toBe('/acme/web/settings')
  })

  it('saves what was edited, announces it and shows a confirmation', async () => {
    const fake = api({ sitesConfigured: true })
    await show()
    // Edit only once the form shows the saved values: the form is keyed by them and remounts
    // (dropping what was typed, and the per-save callbacks) if they arrive after the first edit.
    await expect.element(page.getByRole('textbox', { name: 'Default branch' })).toHaveValue('main')
    await expect
      .element(page.getByRole('checkbox', { name: /Host static sites/ }))
      .not.toBeChecked()
    await page.getByRole('textbox', { name: 'Diff threshold' }).fill('2.5')
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page
      .getByRole('checkbox', { name: /^Approve default-branch builds automatically/ })
      .click()
    await page.getByRole('checkbox', { name: /Host static sites/ }).click()
    // Nothing is sent until Save.
    expect(fake.of('PATCH')).toHaveLength(0)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByText('Settings saved.')).toBeVisible()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    expect(fake.of('PATCH')).toEqual([
      {
        method: 'PATCH',
        path: `${API}/settings`,
        body: {
          slug: 'web',
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

  it('discards what was edited, back to the saved values', async () => {
    const fake = api()
    await show()
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('30')
    await expect
      .element(page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }))
      .toBeChecked()
    expect(fake.of('PATCH')).toHaveLength(0)
  })

  it('saves the name by itself when the field is left, with a Saved note', async () => {
    const fake = api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Web App')
    await page.getByRole('textbox', { name: 'Name' }).fill('Web')
    await page.getByRole('textbox', { name: 'Default branch' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    // Only the name: the workflow settings stay with the Save button.
    expect(fake.of('PATCH')[0]).toMatchObject({ path: `${API}/settings`, body: { name: 'Web' } })
    expect(fake.of('PATCH')[0]?.body).toEqual({ name: 'Web' })
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    await expect
      .element(page.getByRole('status').filter({ hasText: /^Team name saved$/ }))
      .toBeInTheDocument()
  })

  it('saves the name on Enter, and shows why it could not be saved', async () => {
    const fake = api()
    fake.set(`PATCH ${API}/settings`, { status: 400, body: { error: 'Name is too long' } })
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Web App')
    await page.getByRole('textbox', { name: 'Name' }).fill('Webby')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
  })

  it('does not reset what is typed in the form when the name is saved', async () => {
    let saved = settings
    fakeApi({
      [`GET ${API}/settings`]: () => ({ body: response({ settings: saved }) }),
      [`PATCH ${API}/settings`]: (body) => {
        const name = typeof body === 'object' && body && 'name' in body ? String(body.name) : ''
        saved = { ...settings, name }
        return { body: { settings: saved } }
      },
    })
    await show()
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page.getByRole('textbox', { name: 'Name' }).fill('Web')
    await page.getByRole('textbox', { name: 'Default branch' }).click()
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('90')
  })

  describe('checks before saving', () => {
    it('refuses a threshold outside 0 to 100 on the field, and sends nothing', async () => {
      const fake = api()
      await show()
      await page.getByRole('textbox', { name: 'Diff threshold' }).fill('150')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.element(page.getByText('Enter a percentage from 0 to 100')).toBeVisible()
      await page.getByRole('textbox', { name: 'Diff threshold' }).fill('-1')
      await expect.element(page.getByText('Enter a percentage from 0 to 100')).toBeVisible()
      await page.getByRole('textbox', { name: 'Diff threshold' }).fill('100')
      await expect
        .element(page.getByText('Enter a percentage from 0 to 100'))
        .not.toBeInTheDocument()
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it('refuses retention outside 1 to 3650 days, as soon as the field is left', async () => {
      const fake = api()
      await show()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('5000')
      await page.getByRole('textbox', { name: 'Default branch' }).click()
      await expect
        .element(page.getByText('Enter a whole number of days from 1 to 3650'))
        .toBeVisible()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('0')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .element(page.getByText('Enter a whole number of days from 1 to 3650'))
        .toBeVisible()
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it("shows the server's field errors on their fields, without a banner", async () => {
      const fake = api()
      fake.set(`PATCH ${API}/settings`, {
        status: 400,
        body: {
          error: 'Invalid settings',
          fields: { retentionDays: 'Retention is capped at 3650' },
        },
      })
      await show()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.element(page.getByText('Retention is capped at 3650')).toBeVisible()
      expect(page.getByText('Invalid settings').elements()).toHaveLength(0)
    })

    it('keeps the banner when the server names no field', async () => {
      const fake = api()
      fake.set(`PATCH ${API}/settings`, { status: 400, body: { error: 'Something is off' } })
      await show()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Something is off')
    })
  })

  it('keeps Save and Discard disabled until something changes', async () => {
    fakeApi({ [`GET ${API}/settings`]: { body: response() } })
    await show()
    const days = page.getByRole('textbox', { name: 'Keep builds for (days)' })
    await expect.element(days).toHaveValue('30')
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Discard' })).toBeDisabled()
    await days.fill('60')
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await expect.element(page.getByRole('button', { name: 'Discard' })).toBeEnabled()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('still confirms the save when the server answers with the new values', async () => {
    // A real server returns what was saved, so the refetch changes the form's key and remounts
    // it: the confirmation must survive that.
    let saved = settings
    fakeApi({
      [`GET ${API}/settings`]: () => ({ body: response({ settings: saved }) }),
      [`PATCH ${API}/settings`]: (body) => {
        if (
          typeof body === 'object' &&
          body &&
          'retentionDays' in body &&
          typeof body.retentionDays === 'number'
        ) {
          saved = { ...settings, retentionDays: body.retentionDays }
        }
        return { body: { settings: saved } }
      },
    })
    await show()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('30')
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('60')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('60')
    await expect.element(page.getByText('Settings saved.')).toBeVisible()
    await expect
      .element(page.getByRole('status').filter({ hasText: /^Settings saved$/ }))
      .toBeVisible()
  })

  describe('flaky screenshots block merges', () => {
    it('inherits the workspace by default, and says what that currently means', async () => {
      api()
      await show()
      await expect.element(control()).toHaveTextContent('Inherit from workspace (currently: on)')
    })

    it("shows the workspace's current value when it is off", async () => {
      api({ workspace: { flakyBlocksMerge: false } })
      await show()
      await expect.element(control()).toHaveTextContent('Inherit from workspace (currently: off)')
    })

    it('shows an explicit value of its own', async () => {
      api({ settings: { ...settings, flakyBlocksMerge: false } })
      await show()
      await expect.element(control()).toHaveTextContent('Off')
    })

    it('saves an explicit choice, and then another one', async () => {
      const fake = api()
      await show()
      await control().click()
      await page.getByRole('option', { name: 'Off' }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toMatchObject({ flakyBlocksMerge: false })

      await control().click()
      await page.getByRole('option', { name: 'On', exact: true }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toMatchObject({ flakyBlocksMerge: true })
    })

    it('saves null to inherit again', async () => {
      const fake = api({ settings: { ...settings, flakyBlocksMerge: false } })
      await show()
      await control().click()
      await page.getByRole('option', { name: /^Inherit from workspace/ }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toMatchObject({ flakyBlocksMerge: null })
    })
  })

  it("shows the server's refusal when saving fails", async () => {
    const fake = api()
    fake.set(`PATCH ${API}/settings`, {
      status: 400,
      body: { error: 'Default branch is required' },
    })
    await show()
    await page.getByRole('textbox', { name: 'Default branch' }).fill('develop')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Default branch is required')
    expect(page.getByText('Settings saved.').elements()).toHaveLength(0)
  })

  it("sends members to the team's builds instead of showing the settings", async () => {
    api({ canManage: false })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web')
    expect(page.getByRole('textbox', { name: 'Name' }).elements()).toHaveLength(0)
  })

  it("says the team doesn't exist for a 404, and retries other errors", async () => {
    fakeApi({ [`GET ${API}/settings`]: { status: 404, body: { error: 'Team not found' } } })
    await show()
    await expect.element(heading("This team doesn't exist")).toBeVisible()
  })

  it('shows other errors and retries', async () => {
    const fake = fakeApi({ [`GET ${API}/settings`]: { status: 500, body: { error: 'db down' } } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/settings`, { body: response() })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible()
  })

  describe('GitHub', () => {
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
      await expect.element(banner.getByText(/reach GitHub for this team/)).toBeVisible()
      await expect.element(banner.getByText(/GitHub App was removed or suspended/)).toBeVisible()
      await expect.element(banner.getByText(/Integrations/)).toBeVisible()
    })

    it('shows no warning for a healthy link, and names the linked repository', async () => {
      api({ github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }) })
      await show()
      await expect.element(page.getByText('acme/web')).toBeVisible()
      expect(page.getByRole('alert').elements()).toHaveLength(0)
      expect(page.getByRole('textbox', { name: 'Repository' }).elements()).toHaveLength(0)
    })

    it('links to the workspace integrations to change the repository', async () => {
      api({ github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }) })
      await show()
      await expect
        .element(page.getByRole('link', { name: 'Change' }))
        .toHaveAttribute('href', '/workspaces/acme/settings/integrations')
    })

    it('removes the repository link only after confirming', async () => {
      const fake = api(
        { github: github({ installationId: '4242', repoRef: 'acme/web', attention: null }) },
        { [`DELETE ${API}/github`]: { status: 204 } },
      )
      await show()
      await page.getByRole('button', { name: 'Remove repository link' }).click()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
      expect(fake.of('DELETE')).toHaveLength(0)
      await page.getByRole('button', { name: 'Remove repository link' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
      await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
    })
  })

  describe('icon and colour', () => {
    const ARIA = { color: 'slate', icon: null as string | null }

    it('shows the tile and saves a picked colour at once', async () => {
      const fake = api(
        { appearance: ARIA },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'plum', icon: null } } } },
      )
      await show()
      await expect.element(page.getByRole('img', { name: 'Web App' })).toBeVisible()
      await page.getByRole('radio', { name: 'Plum' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]).toMatchObject({
        path: `${API}/appearance`,
        body: { color: 'plum' },
      })
    })

    it('confirms a saved pick inline, with no Save button in sight', async () => {
      api(
        { appearance: ARIA },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'plum', icon: null } } } },
      )
      await show()
      await page.getByRole('radio', { name: 'Plum' }).click()
      await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    })

    it('searches the 31 icons and saves a picked one, or null for the first letter', async () => {
      const fake = api(
        { appearance: { color: 'slate', icon: 'globe' } },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'slate', icon: null } } } },
      )
      await show()
      const group = page.getByRole('group', { name: 'Icon' })
      // The first letter plus every icon.
      await expect.element(group).toBeVisible()
      expect(group.getByRole('button').elements()).toHaveLength(32)
      await expect
        .element(group.getByRole('button', { name: 'globe' }))
        .toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('rock')
      await page.getByRole('button', { name: 'rocket' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toEqual({ icon: 'rocket' })
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('zzz')
      await expect.element(page.getByText('No icon matches “zzz”.')).toBeVisible()
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('')
      await page.getByRole('button', { name: 'First letter' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toEqual({ icon: null })
    })

    it("shows the server's refusal", async () => {
      const fake = api({ appearance: ARIA })
      fake.set(`PATCH ${API}/appearance`, { status: 400, body: { error: 'Unknown icon' } })
      await show()
      await page.getByRole('radio', { name: 'Moss' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Unknown icon')
    })
  })

  describe('danger zone', () => {
    it('deletes the team once its address is typed back, then goes to the teams list', async () => {
      const fake = api({}, { [`DELETE ${API}`]: { status: 204 } })
      const { router } = await show()
      const dialog = await openDelete()
      const confirm = dialog.getByRole('button', { name: 'Delete team' })
      await expect.element(confirm).toBeDisabled()
      await dialog.getByRole('textbox', { name: 'Type acme/web to confirm' }).fill('acme/other')
      await expect.element(confirm).toBeDisabled()
      await dialog.getByRole('textbox', { name: 'Type acme/web to confirm' }).fill('acme/web')
      await confirm.click()
      await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
      await expect.poll(() => router.state.location.pathname).toBe('/')
    })

    it("shows the server's refusal and keeps the dialog", async () => {
      api(
        {},
        {
          [`DELETE ${API}`]: {
            status: 403,
            body: { error: 'Only owners and admins can change this' },
          },
        },
      )
      await show()
      const dialog = await openDelete()
      await dialog.getByRole('textbox', { name: 'Type acme/web to confirm' }).fill('acme/web')
      await dialog.getByRole('button', { name: 'Delete team' }).click()
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Only owners and admins can change this')
    })
  })

  it('has no CI token or webhooks on this page: they have their own', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible()
    expect(heading('CI token').elements()).toHaveLength(0)
    expect(heading('Webhooks').elements()).toHaveLength(0)
  })
})
