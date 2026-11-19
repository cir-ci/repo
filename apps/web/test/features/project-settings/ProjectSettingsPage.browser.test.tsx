import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ProjectSettingsPage } from '#features/project-settings/ProjectSettingsPage.tsx'
import { filterIcons, ICON_PAGE, iconLabel } from '#features/projects/appearance.ts'
import { fakeApi, hangingFetch, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'
import { openDialogs, toastNamed } from '#test/support/toast.ts'

/** The icon grid draws its rows in view plus a few either side: far fewer than the 2,000 icons. */
const DRAWN_AT_MOST = 150

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
  sitesFromActions: false,
  sitesArtifactName: 'circi-site',
  sitesArtifactSiteName: null as string | null,
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
    sitesFromActionsResult: null,
    ...over,
  }
}

const API = '/api/projects/acme/web'
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
  renderPage(<ProjectSettingsPage />, {
    route: '/$workspace/$project/settings/general',
    url: '/acme/web/settings/general',
    announcer: true,
    otherRoutes: [
      '/$workspace/$project',
      '/$workspace/$project/settings',
      '/workspaces/$workspace/settings',
      '/workspaces/$workspace/settings/projects',
    ],
  })
const openPicker = () => page.getByRole('button', { name: 'Change icon and color' }).click()
const field = (name: string) => page.getByRole('textbox', { name })
const heading = (name: string) => page.getByRole('heading', { name })

async function openDelete() {
  await page.getByRole('button', { name: 'Delete project' }).click()
  return page.getByRole('dialog', { name: 'Delete Web App?' })
}

describe('ProjectSettingsPage', () => {
  it('shows its breadcrumb while loading and announces a slow load', async () => {
    hangingFetch()
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.poll(() => crumbs.element().textContent).toBe('acmeSettingsProjectswebGeneral')
    await expect.element(page.getByRole('status').first()).toHaveTextContent('Loading general')
  })

  it("links the breadcrumb to the project's Builds page and shows its name once loaded", async () => {
    api()
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect
      .element(crumbs.getByRole('link', { name: 'Settings' }))
      .toHaveAttribute('href', '/workspaces/acme/settings')
    await expect
      .element(crumbs.getByRole('link', { name: 'Projects' }))
      .toHaveAttribute('href', '/workspaces/acme/settings/projects')
    // The project is a crumb that goes up to its hub; the page is the current crumb (the heading).
    await expect
      .element(crumbs.getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('href', '/acme/web/settings')
    await expect.element(heading('General')).toBeVisible()
    // No in-page way back (the sidebar has settings' only one), and no tabs.
    expect(
      page
        .getByRole('link', { name: 'Web App' })
        .elements()
        .filter((el) => !el.closest('nav')),
    ).toHaveLength(0)
    expect(page.getByRole('navigation', { name: 'Web App settings' }).elements()).toHaveLength(0)
    expect(document.title).toBe('General · web · CirCI')
  })

  it('fills the form from the saved settings, converting the threshold to a percentage', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Web App')
    await expect.element(page.getByRole('textbox', { name: 'Default branch' })).toHaveValue('main')
    await expect.element(page.getByRole('textbox', { name: 'Diff threshold' })).toHaveValue('0.1')
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('30')
    await expect.element(page.getByRole('textbox', { name: 'URL slug' })).toHaveValue('web')
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

  it('renames the slug with Save and moves to the new address, warning while editing', async () => {
    const fake = api(
      {},
      { [`PATCH ${API}/settings`]: { body: { settings: { ...settings, slug: 'web-app' } } } },
    )
    const { router } = await show()
    await expect.element(page.getByRole('textbox', { name: 'URL slug' })).toHaveValue('web')
    expect(page.getByText(/stop working/).elements()).toHaveLength(0)
    await page.getByRole('textbox', { name: 'URL slug' }).fill('web-app')
    await expect.element(page.getByText(/stop working/)).toBeVisible()
    expect(fake.of('PATCH')).toHaveLength(0)
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    // Only the address: the other sections are untouched.
    expect(fake.of('PATCH')[0]?.body).toEqual({ slug: 'web-app' })
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web-app/settings/general')
  })

  it('refuses a slug that is not an address, on the field, and sends nothing', async () => {
    const fake = api()
    await show()
    await page.getByRole('textbox', { name: 'URL slug' }).fill('Not An Address')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect.element(page.getByText(/lowercase letters, digits/)).toBeVisible()
    expect(fake.of('PATCH')).toHaveLength(0)
  })

  it('follows a slug rename: the sidebar refreshes', async () => {
    api(
      {},
      {
        [`PATCH ${API}/settings`]: { body: { settings: { ...settings, slug: 'web-app' } } },
        'GET /api/workspaces/acme/sidebar': { body: { projects: [], views: [], inboxUnread: 0 } },
      },
    )
    const { queryClient } = await show()
    // The sidebar has read the sidebar of the workspace: a rename makes it stale.
    await queryClient.fetchQuery({
      queryKey: ['sidebar', 'acme'],
      queryFn: () => fetch('/api/workspaces/acme/sidebar').then((r) => r.json()),
    })
    expect(queryClient.getQueryState(['sidebar', 'acme'])?.isInvalidated).toBe(false)
    await expect.element(page.getByRole('textbox', { name: 'URL slug' })).toHaveValue('web')
    await page.getByRole('textbox', { name: 'URL slug' }).fill('web-app')
    await page.getByRole('button', { name: 'Save details' }).click()
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
    await page.getByRole('textbox', { name: 'URL slug' }).fill('taken')
    await page.getByRole('button', { name: 'Save details' }).click()
    // The failure toasts too; the section's banner is the alert (the toast isn't one).
    const alert = page.getByRole('alert')
    await expect.element(alert).toMatchTextContent(/is already taken/)
    await expect.poll(() => page.getByText(/is already taken/).elements()).toHaveLength(2)
    expect(alert.elements()).toHaveLength(1)
    expect(router.state.location.pathname).toBe('/acme/web/settings/general')
  })

  it('saves each section by itself, with only its own fields', async () => {
    const fake = api({ sitesConfigured: true })
    await show()
    // Edit only once the sections show the saved values: each is keyed by them and remounts
    // (dropping what was typed) if they arrive after the first edit.
    await expect.element(page.getByRole('textbox', { name: 'Diff threshold' })).toHaveValue('0.1')
    await expect
      .element(page.getByRole('checkbox', { name: /Host static sites/ }))
      .not.toBeChecked()
    await page.getByRole('textbox', { name: 'Diff threshold' }).fill('2.5')
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page
      .getByRole('checkbox', { name: /^Approve default-branch builds automatically/ })
      .click()
    await page.getByRole('checkbox', { name: /Host static sites/ }).click()
    // Nothing is sent until a section's Save.
    expect(fake.of('PATCH')).toHaveLength(0)
    await page.getByRole('button', { name: 'Save comparison' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    expect(fake.of('PATCH')[0]?.body).toEqual({ diffThreshold: 0.025, retentionDays: 90 })
    await expect.element(toastNamed('Comparison settings saved')).toBeVisible()
    // The other sections keep what was typed, and their own Save.
    await expect
      .element(page.getByRole('checkbox', { name: /^Approve default-branch builds automatically/ }))
      .toBeChecked()
    await page.getByRole('button', { name: 'Save merge gate' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
    expect(fake.of('PATCH')[1]?.body).toEqual({
      autoApproveDefaultBranch: true,
      blockMergeOnChanges: true,
      flakyBlocksMerge: null,
    })
    await page.getByRole('button', { name: 'Save hosted sites' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(3)
    expect(fake.of('PATCH')[2]?.body).toEqual({ staticHostingEnabled: true })
  })

  describe('Hosted sites: upload from GitHub Actions', () => {
    const linked = github({ installationId: '9', repoRef: 'acme/web', attention: null })
    const hosted = { ...settings, staticHostingEnabled: true }

    it('waits for Save: the artifact and site names appear once it is on, and only changes are sent', async () => {
      const fake = api({ sitesConfigured: true, settings: hosted, github: linked })
      await show()
      const toggle = page.getByRole('checkbox', { name: /^Upload sites from GitHub Actions/ })
      await expect.element(toggle).not.toBeChecked()
      expect(page.getByRole('textbox', { name: /^Artifact name/ }).elements()).toHaveLength(0)
      await toggle.click()
      await expect
        .element(page.getByRole('textbox', { name: /^Artifact name/ }))
        .toHaveValue('circi-site')
      await page.getByRole('textbox', { name: /^Artifact name/ }).fill('storybook-static')
      await page.getByRole('textbox', { name: /^Site name/ }).fill('storybook')
      expect(fake.of('PATCH')).toHaveLength(0)
      await page.getByRole('button', { name: 'Save hosted sites' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toEqual({
        sitesFromActions: true,
        sitesArtifactName: 'storybook-static',
        sitesArtifactSiteName: 'storybook',
      })
      await expect.element(toastNamed('Hosted sites saved')).toBeVisible()
    })

    it('does not save an empty artifact name', async () => {
      const fake = api({
        sitesConfigured: true,
        settings: { ...hosted, sitesFromActions: true },
        github: linked,
      })
      await show()
      await page.getByRole('textbox', { name: /^Artifact name/ }).fill('')
      await page.getByRole('button', { name: 'Save hosted sites' }).click()
      await expect.element(page.getByText('Enter the artifact name')).toBeVisible()
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it('needs a linked repository', async () => {
      api({ sitesConfigured: true, settings: hosted })
      await show()
      await expect
        .element(page.getByRole('checkbox', { name: /^Upload sites from GitHub Actions/ }))
        .toBeDisabled()
    })

    it('says how the last run went, and what to fix', async () => {
      api({
        sitesConfigured: true,
        settings: { ...hosted, sitesFromActions: true },
        github: linked,
        sitesFromActionsResult: {
          status: 'failed',
          message: 'Run 77 has no artifact named "circi-site".',
          runId: '77',
          commitSha: 'abc1234',
          at: '2026-11-17T10:00:00.000Z',
        },
      })
      await show()
      await expect
        .element(page.getByRole('alert').filter({ hasText: 'no artifact named "circi-site"' }))
        .toBeVisible()
    })
  })

  it("shows a section's Save and Discard only while it has changes, one primary at a time", async () => {
    api()
    await show()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toBeVisible()
    expect(page.getByRole('button', { name: /^Save / }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Discard' }).elements()).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('60')
    await page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }).click()
    await expect.element(page.getByRole('button', { name: 'Save comparison' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Save merge gate' })).toBeVisible()
    // The section edited last has the primary Save.
    await expect
      .element(page.getByRole('button', { name: 'Save merge gate' }))
      .toHaveAttribute('data-variant', 'primary')
    await expect
      .element(page.getByRole('button', { name: 'Save comparison' }))
      .toHaveAttribute('data-variant', 'secondary')
    expect(
      page
        .getByRole('button')
        .elements()
        .filter((el) => el.getAttribute('data-variant') === 'primary'),
    ).toHaveLength(1)
  })

  it("keeps a section's Save at the bottom of the scrolling panel while the section is in view", async () => {
    api()
    await page.viewport(1000, 500)
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Diff threshold' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Diff threshold' }).fill('5')
    const save = page.getByRole('button', { name: 'Save comparison' })
    await expect.element(save).toBeVisible()
    // Scroll to the top of the section: the bar rests under the section if it is off-screen, or sticks in view.
    page
      .getByRole('textbox', { name: 'Diff threshold' })
      .element()
      .scrollIntoView({ block: 'start' })
    await expect
      .poll(() => {
        const rect = save.element().getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight
      })
      .toBe(true)
  })

  it('discards what was edited in a section, back to its saved values', async () => {
    const fake = api()
    await show()
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }).click()
    // Discard in one section leaves the other's edit.
    const comparison = page.getByRole('form', { name: 'Comparison' })
    await comparison.getByRole('button', { name: 'Discard' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('30')
    await expect
      .element(page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }))
      .not.toBeChecked()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect
      .element(page.getByRole('checkbox', { name: /^Unreviewed changes block merging/ }))
      .toBeChecked()
    expect(fake.of('PATCH')).toHaveLength(0)
  })

  describe('display settings', () => {
    it('shows the picture and the name on one row, under Identity', async () => {
      api()
      await show()
      await expect.element(heading('Identity')).toBeVisible()
      expect(page.getByText('Name and picture').elements()).toHaveLength(0)
      const avatar = page.getByRole('button', { name: 'Change icon and color' }).element()
      await page.viewport(1200, 800)
      await expect.element(field('Display name')).toBeVisible()
      const box = field('Display name').element().getBoundingClientRect()
      expect(box.left).toBeGreaterThan(avatar.getBoundingClientRect().right - 1)
    })

    it('has no ✓ for the name: it saves when left, with no Save form around it', async () => {
      api()
      await show()
      await expect.element(field('Display name')).toHaveValue('Web App')
      await field('Display name').fill('Web')
      expect(page.getByRole('button', { name: 'Save Display name' }).elements()).toHaveLength(0)
      expect(field('Display name').element().closest('form')).toBeNull()
    })

    it('saves the name when the field is left, only the name, with Undo in the toast', async () => {
      const fake = api()
      await show()
      await expect.element(field('Display name')).toHaveValue('Web App')
      await field('Display name').fill('Web')
      await field('Diff threshold').click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toEqual({ name: 'Web' })
      const toast = toastNamed('Renamed the project to Web')
      await expect.element(toast).toBeInTheDocument()
      await expect.element(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
      await toast.getByRole('button', { name: 'Undo' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toEqual({ name: 'Web App' })
    })

    it('saves on Enter, and shows why it could not be saved', async () => {
      const fake = api()
      fake.set(`PATCH ${API}/settings`, { status: 400, body: { error: 'Name is too long' } })
      await show()
      await expect.element(field('Display name')).toHaveValue('Web App')
      await field('Display name').fill('Webby')
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    })

    it('puts the saved text back on Escape and sends nothing, even when the field is then left', async () => {
      const fake = api()
      await show()
      await field('Display name').fill('Web')
      await userEvent.keyboard('{Escape}')
      await field('Diff threshold').click()
      await expect.element(field('Display name')).toHaveValue('Web App')
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it('refuses an empty name on the field, and sends nothing', async () => {
      const fake = api()
      await show()
      await field('Display name').fill('  ')
      await field('Diff threshold').click()
      await expect.element(page.getByText('Enter a name')).toBeVisible()
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it('does not reset what is typed in another section when the name is saved', async () => {
      let saved = settings
      fakeApi({
        [`GET ${API}/settings`]: () => ({ body: response({ settings: saved }) }),
        [`PATCH ${API}/settings`]: (body) => {
          const patch = typeof body === 'object' && body ? body : {}
          saved = { ...saved, ...patch }
          return { body: { settings: saved } }
        },
      })
      await show()
      await field('Keep builds for (days)').fill('90')
      await field('Display name').fill('Web')
      await userEvent.keyboard('{Enter}')
      await expect.element(toastNamed('Renamed the project to Web')).toBeInTheDocument()
      await expect.element(field('Keep builds for (days)')).toHaveValue('90')
    })

    it('saves the default branch with Save in Details, with its own PATCH and no other field', async () => {
      const fake = api()
      await show()
      await expect.element(page.getByText('Its approved builds are the baselines.')).toBeVisible()
      await field('Default branch').fill('develop')
      await page.getByRole('button', { name: 'Save details' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toEqual({ defaultBranch: 'develop' })
      await expect.element(toastNamed('Details saved')).toBeVisible()
    })

    it('refuses an empty branch on the field, and sends nothing', async () => {
      const fake = api()
      await show()
      await field('Default branch').fill('  ')
      await page.getByRole('button', { name: 'Save details' }).click()
      await expect.element(page.getByText('Enter a branch name')).toBeVisible()
      expect(fake.of('PATCH')).toHaveLength(0)
    })

    it('keeps the address and branch in the Details section, not in Identity', async () => {
      api()
      await show()
      await expect.element(field('Keep builds for (days)')).toBeVisible()
      const details = page.getByRole('region', { name: 'Details' }).element()
      expect(details.querySelector('input[name="slug"]')).not.toBeNull()
      expect(details.querySelector('input[name="defaultBranch"]')).not.toBeNull()
      expect(details.querySelector('input[name="name"]')).toBeNull()
    })
  })

  describe('checks before saving', () => {
    it('refuses a threshold outside 0 to 100 on the field, and sends nothing', async () => {
      const fake = api()
      await show()
      await page.getByRole('textbox', { name: 'Diff threshold' }).fill('150')
      await page.getByRole('button', { name: 'Save comparison' }).click()
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
      await page.getByRole('textbox', { name: 'Diff threshold' }).click()
      await expect
        .element(page.getByText('Enter a whole number of days from 1 to 3650'))
        .toBeVisible()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('0')
      await page.getByRole('button', { name: 'Save comparison' }).click()
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
      await page.getByRole('button', { name: 'Save comparison' }).click()
      await expect.element(page.getByText('Retention is capped at 3650')).toBeVisible()
      expect(page.getByText('Invalid settings').elements()).toHaveLength(0)
    })

    it('keeps the banner when the server names no field', async () => {
      const fake = api()
      fake.set(`PATCH ${API}/settings`, { status: 400, body: { error: 'Something is off' } })
      await show()
      await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
      await page.getByRole('button', { name: 'Save comparison' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Something is off')
    })
  })

  it('still confirms the save when the server answers with the new values', async () => {
    // A real server returns what was saved, so the refetch changes the section's key and remounts
    // it: the confirmation is a toast, which survives that.
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
    await page.getByRole('button', { name: 'Save comparison' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Keep builds for (days)' }))
      .toHaveValue('60')
    await expect.element(toastNamed('Comparison settings saved')).toBeVisible()
    // Saved: the section is clean again, so its Save is gone.
    await expect
      .element(page.getByRole('button', { name: 'Save comparison' }))
      .not.toBeInTheDocument()
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
      await page.getByRole('button', { name: 'Save merge gate' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toMatchObject({ flakyBlocksMerge: false })

      await control().click()
      await page.getByRole('option', { name: 'On', exact: true }).click()
      await page.getByRole('button', { name: 'Save merge gate' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toMatchObject({ flakyBlocksMerge: true })
    })

    it('saves null to inherit again', async () => {
      const fake = api({ settings: { ...settings, flakyBlocksMerge: false } })
      await show()
      await control().click()
      await page.getByRole('option', { name: /^Inherit from workspace/ }).click()
      await page.getByRole('button', { name: 'Save merge gate' }).click()
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
    await page.getByRole('textbox', { name: 'Keep builds for (days)' }).fill('90')
    await page.getByRole('button', { name: 'Save comparison' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Default branch is required')
    // The field keeps its own message; the toast names the action as a whole.
    await expect
      .element(toastNamed("Couldn't save settings: Default branch is required"))
      .toBeVisible()
  })

  it("sends members to the project's settings hub, inside settings, instead of showing the settings", async () => {
    api({ canManage: false })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings')
    expect(page.getByRole('textbox', { name: 'Display name' }).elements()).toHaveLength(0)
  })

  it("says the project doesn't exist for a 404, and retries other errors", async () => {
    fakeApi({ [`GET ${API}/settings`]: { status: 404, body: { error: 'Project not found' } } })
    await show()
    await expect.element(heading("This project doesn't exist")).toBeVisible()
  })

  it('shows other errors and retries', async () => {
    const fake = fakeApi({ [`GET ${API}/settings`]: { status: 500, body: { error: 'db down' } } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/settings`, { body: response() })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Display name' })).toBeVisible()
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
      await expect.element(banner.getByText(/reach GitHub for this project/)).toBeVisible()
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

  describe('icon and color', () => {
    const ARIA = { color: 'slate', icon: null as string | null }

    it('saves a picked colour at once, from the popover on the avatar', async () => {
      const fake = api(
        { appearance: ARIA },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'plum', icon: null } } } },
      )
      await show()
      await openPicker()
      await page.getByRole('radio', { name: 'Plum' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]).toMatchObject({
        path: `${API}/appearance`,
        body: { color: 'plum' },
      })
    })

    it('moves between the colours with the arrow keys, saving the one it lands on', async () => {
      const fake = api(
        { appearance: ARIA },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'plum', icon: null } } } },
      )
      await show()
      await openPicker()
      const group = page.getByRole('radiogroup', { name: 'Color' })
      await expect.element(group).toBeVisible()
      const slate = group.getByRole('radio', { name: 'Slate' })
      await expect.element(slate).toBeChecked()
      slate.element().focus()
      await userEvent.keyboard('{ArrowRight}')
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).not.toMatchObject({ color: 'slate' })
    })

    it('keeps the colours and icons out of the page until the avatar is clicked, and Escape returns focus', async () => {
      api({ appearance: ARIA })
      await show()
      expect(page.getByRole('radio', { name: 'Plum' }).elements()).toHaveLength(0)
      const button = page.getByRole('button', { name: 'Change icon and color' })
      await button.click()
      await expect.element(page.getByRole('dialog', { name: 'Icon and color' })).toBeVisible()
      await userEvent.keyboard('{Escape}')
      await expect.poll(() => openDialogs()).toHaveLength(0)
      await expect.element(button).toHaveFocus()
    })

    it('confirms a saved pick inline, with no Save button in sight', async () => {
      api(
        { appearance: ARIA },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'plum', icon: null } } } },
      )
      await show()
      await openPicker()
      await page.getByRole('radio', { name: 'Plum' }).click()
      await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    })

    it('searches every Lucide icon, saves a picked one, or null for no icon', async () => {
      const fake = api(
        { appearance: { color: 'slate', icon: 'globe' } },
        { [`PATCH ${API}/appearance`]: { body: { appearance: { color: 'slate', icon: null } } } },
      )
      await show()
      await openPicker()
      const group = page.getByRole('radiogroup', { name: 'Icon' })
      // Only the rows in view are drawn: "No icon" and a screenful, not 2,000 buttons.
      await expect.element(group.getByRole('radio', { name: 'No icon' })).toBeVisible()
      await expect.poll(() => group.getByRole('radio').elements().length).toBeGreaterThan(10)
      expect(group.getByRole('radio').elements().length).toBeLessThan(DRAWN_AT_MOST)
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('globe')
      await expect.element(group.getByRole('radio', { name: 'Globe', exact: true })).toBeChecked()
      // "dog" is not one of the first 31 icons.
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('dog')
      await page.getByRole('radio', { name: 'Dog', exact: true }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
      expect(fake.of('PATCH')[0]?.body).toEqual({ icon: 'dog' })
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('zzz')
      await expect.element(page.getByText('No icon matches “zzz”.')).toBeVisible()
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('')
      await page.getByRole('radio', { name: 'No icon' }).click()
      await expect.poll(() => fake.of('PATCH')).toHaveLength(2)
      expect(fake.of('PATCH')[1]?.body).toEqual({ icon: null })
    })

    it('is one radio group: one Tab stop, arrows move within the grid and choose', async () => {
      const fake = api({ appearance: ARIA }, { [`PATCH ${API}/appearance`]: { status: 200 } })
      await show()
      await openPicker()
      const group = page.getByRole('radiogroup', { name: 'Icon' })
      await expect.element(group.getByRole('radio', { name: 'No icon' })).toBeChecked()
      const radios = () => group.getByRole('radio').elements()
      // The chosen one is the only Tab stop.
      expect(radios().filter((el) => el.tabIndex === 0)).toHaveLength(1)
      group.getByRole('radio', { name: 'No icon' }).element().focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(document.activeElement).toBe(radios()[1])
      // Down goes to the cell below, the one at the same x a row further.
      const here = radios()[1]!.getBoundingClientRect()
      await userEvent.keyboard('{ArrowDown}')
      await expect
        .poll(() => Math.round(document.activeElement?.getBoundingClientRect().left ?? 0))
        .toBe(Math.round(here.left))
      expect(document.activeElement?.getBoundingClientRect().top).toBeGreaterThan(here.top)
      // Each step chooses a cell, but the save waits for the arrowing to pause: one PATCH, not two.
      expect(fake.of('PATCH')).toHaveLength(0)
      await expect.poll(() => fake.of('PATCH'), { timeout: 3000 }).toHaveLength(1)
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(fake.of('PATCH')).toHaveLength(1)
    })

    it('loads the next icons as the grid scrolls, drawing only the rows in view', async () => {
      api({ appearance: ARIA })
      await show()
      await openPicker()
      const group = page.getByRole('radiogroup', { name: 'Icon' })
      await expect.element(group.getByRole('radio', { name: 'No icon' })).toBeVisible()
      expect(page.getByRole('button', { name: 'Show more icons' }).elements()).toHaveLength(0)
      // A search with a few pages of matches: scrolling through all 2,167 icons is 37 page loads
      // and a module import per icon, which a busy CI machine did not finish in 15 s. The paging and
      // the drawing are the same for these 397 ("le": "Leaf", "Circle", …) as for all of them.
      const matches = filterIcons('le')
      expect(matches.length).toBeGreaterThan(ICON_PAGE * 4)
      expect(matches.length).toBeGreaterThan(DRAWN_AT_MOST)
      await page.getByRole('textbox', { name: 'Find an icon' }).fill('le')
      const scroller = group.element().parentElement
      if (!scroller) throw new Error('no scroll box')
      const last = iconLabel(matches.at(-1) ?? '')
      await expect
        .element(group.getByRole('radio', { name: last, exact: true }))
        .not.toBeInTheDocument()
      // Scroll to the end until the last match has loaded and is drawn.
      await expect
        .poll(
          () => {
            scroller.scrollTop = scroller.scrollHeight
            scroller.dispatchEvent(new Event('scroll'))
            return group.getByRole('radio', { name: last, exact: true }).elements().length
          },
          { timeout: 15_000, interval: 50 },
        )
        .toBe(1)
      // Still a screenful of radios, plus the chosen one ("No icon", scrolled out of view), which
      // stays drawn so the group keeps its Tab stop.
      expect(group.getByRole('radio').elements().length).toBeLessThan(DRAWN_AT_MOST)
      expect(group.getByRole('radio', { name: 'No icon' }).element().tabIndex).toBe(0)
    })

    it("shows the server's refusal", async () => {
      const fake = api({ appearance: ARIA })
      fake.set(`PATCH ${API}/appearance`, { status: 400, body: { error: 'Unknown icon' } })
      await show()
      await openPicker()
      await page.getByRole('radio', { name: 'Moss' }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('Unknown icon')
    })
  })

  describe('danger zone', () => {
    it('deletes the project once its address is typed back, then goes to the projects list', async () => {
      const fake = api({}, { [`DELETE ${API}`]: { status: 204 } })
      const { router } = await show()
      const dialog = await openDelete()
      const confirm = dialog.getByRole('button', { name: 'Delete project' })
      await expect.element(confirm).toBeDisabled()
      await dialog.getByRole('textbox', { name: 'Type acme/web to confirm' }).fill('acme/other')
      await expect.element(confirm).toBeDisabled()
      await dialog.getByRole('textbox', { name: 'Type acme/web to confirm' }).fill('acme/web')
      await confirm.click()
      await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
      await expect
        .poll(() => router.state.location.pathname)
        .toBe('/workspaces/acme/settings/projects')
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
      await dialog.getByRole('button', { name: 'Delete project' }).click()
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Only owners and admins can change this')
    })
  })

  it('has no CI token or webhooks on this page: they have their own', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Display name' })).toBeVisible()
    expect(heading('CI token').elements()).toHaveLength(0)
    expect(heading('Webhooks').elements()).toHaveLength(0)
  })
})

describe('ProjectSettingsPage opened at a setting', () => {
  it.each([
    ['merge-gate', /^Flaky-only changes block merging/, 'combobox'],
    ['retention', 'Keep builds for (days)', 'textbox'],
    ['default-branch', 'Default branch', 'textbox'],
  ] as const)('#%s scrolls to its setting and focuses it', async (hash, name, role) => {
    api()
    await page.viewport(1000, 500)
    await renderPage(<ProjectSettingsPage />, {
      route: '/$workspace/$project/settings/general',
      url: `/acme/web/settings/general#${hash}`,
      announcer: true,
      otherRoutes: ['/$workspace/$project/settings', '/workspaces/$workspace/settings'],
    })
    // Once the settings have loaded, the setting is scrolled into view and focused.
    await expect.element(page.getByRole(role, { name })).toHaveFocus()
    // The scroll is smooth: wait for it to settle with the setting inside the window.
    await expect
      .poll(() => {
        const rect = document.getElementById(hash)?.getBoundingClientRect()
        return rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight
      })
      .toBe(true)
  })
})
