import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { WorkspaceSettingsHubPage } from '#features/workspace-settings/WorkspaceSettingsHubPage.tsx'
import { workspace } from '#test/features/instance/fixtures.ts'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

interface Options {
  /** The instance admin belongs to the workspace. */
  member?: boolean
  canManage?: boolean
  deleted?: boolean
  integrations?: number
}

function api(options: Options = {}) {
  const member = options.member ?? true
  const canManage = options.canManage ?? true
  const routes: Record<string, ReplyHandler> = {
    'GET /api/instance/workspaces': {
      body: {
        workspaces: [
          workspace({
            youAreMember: member,
            ...(options.deleted ? { deletedAt: '2026-11-01T00:00:00.000Z', daysLeft: 22 } : {}),
          }),
        ],
      },
    },
    'GET /api/workspaces/acme': {
      body: { canManage, isOwner: canManage, name: 'Acme', slug: 'acme', picture: null },
    },
    'GET /api/workspaces/acme/auth': {
      body: {
        canManage,
        settings: {
          emailLoginEnabled: true,
          passwordLoginEnabled: true,
          signinGithub: true,
          signinGoogle: false,
        },
        instance: { password: true, email: true, github: true, google: true },
      },
    },
    'GET /api/workspaces/acme/integrations': {
      body: {
        canManage,
        catalog: [],
        integrations: Array.from({ length: options.integrations ?? 2 }, (_, i) => ({
          id: `i${i}`,
        })),
      },
    },
  }
  return fakeApi(routes)
}

const PAGES = [
  '/workspaces/$workspace/settings/general',
  '/workspaces/$workspace/settings/members',
  '/workspaces/$workspace/settings/teams',
  '/workspaces/$workspace/settings/sign-in',
  '/workspaces/$workspace/settings/integrations',
  '/workspaces/$workspace/settings/storage',
  '/instance/workspaces',
]

const show = (viewport?: [number, number]) =>
  renderPage(<WorkspaceSettingsHubPage workspace="acme" />, {
    route: '/workspaces/$workspace/settings',
    url: '/workspaces/acme/settings',
    announcer: true,
    ...(viewport ? { viewport } : {}),
    otherRoutes: PAGES,
  })

const rows = (group: string) =>
  page
    .getByRole('region', { name: group })
    .getByRole('link')
    .elements()
    .map((el) => el.querySelector('span span')?.textContent)

/** The "‹ Workspaces" button in the page's column (the breadcrumb has a link of the same name). */
const backLink = () =>
  page
    .getByRole('link', { name: 'Workspaces' })
    .elements()
    .find((el) => !el.closest('nav'))

const rowOf = (name: string) => page.getByRole('link', { name: new RegExp(`^${name}`) })

describe('WorkspaceSettingsHubPage', () => {
  it('has the workspace name as its title and its size as the subtitle', async () => {
    api()
    await show()
    await expect.element(page.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible()
    await expect.element(page.getByText('6 members · 3 teams')).toBeVisible()
  })

  it('goes back to the All workspaces list with "‹ Workspaces", and names it in its breadcrumb', async () => {
    api()
    const { router } = await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(crumbs.getByText('Instance')).toBeVisible()
    await expect.element(crumbs.getByRole('link', { name: 'Workspaces' })).toBeVisible()
    await expect.poll(backLink).not.toBeUndefined()
    await userEvent.click(backLink()!)
    await expect.poll(() => router.state.location.pathname).toBe('/instance/workspaces')
  })

  it('groups one row for each page: Workspace, Access, Connections and Data', async () => {
    api()
    await show()
    await expect.element(rowOf('General')).toBeVisible()
    expect(rows('Workspace')).toEqual(['General', 'Members', 'Teams'])
    expect(rows('Access')).toEqual(['Sign-in and domains'])
    expect(rows('Connections')).toEqual(['Integrations'])
    expect(rows('Data')).toEqual(['Storage and retention'])
  })

  it('summarises what is set, from data the app already has', async () => {
    api()
    await show()
    await expect.element(rowOf('General').getByText('acme')).toBeVisible()
    await expect.element(rowOf('Members').getByText('6 members')).toBeVisible()
    await expect.element(rowOf('Teams').getByText('3 teams')).toBeVisible()
    // Email, password and GitHub are on; Google is off.
    await expect.element(rowOf('Sign-in and domains').getByText('3 methods')).toBeVisible()
    await expect.element(rowOf('Integrations').getByText('2 integrations')).toBeVisible()
    await expect.element(rowOf('Storage and retention').getByText('1.5 MB')).toBeVisible()
  })

  it('says None when there are no integrations', async () => {
    api({ integrations: 0 })
    await show()
    await expect.element(rowOf('Integrations').getByText('None')).toBeVisible()
  })

  it.each([
    ['General', '/workspaces/acme/settings/general'],
    ['Members', '/workspaces/acme/settings/members'],
    ['Teams', '/workspaces/acme/settings/teams'],
    ['Sign-in and domains', '/workspaces/acme/settings/sign-in'],
    ['Integrations', '/workspaces/acme/settings/integrations'],
    ['Storage and retention', '/workspaces/acme/settings/storage'],
  ])('opens %s from its row, with no page reload', async (name, path) => {
    api()
    const { router } = await show()
    const row = rowOf(name)
    await expect.element(row).toHaveAttribute('href', path)
    await row.click()
    await expect.poll(() => router.state.location.pathname).toBe(path)
  })

  it('leaves no way out to the app', async () => {
    api()
    await show()
    await expect.element(rowOf('General')).toBeVisible()
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href'))
    expect(hrefs.filter((h) => !h?.startsWith('/workspaces/acme/settings'))).toEqual([])
  })

  it('gives an owner or admin who only belongs to the workspace as a member Members and Teams', async () => {
    api({ canManage: false })
    await show()
    await expect.element(rowOf('Members')).toBeVisible()
    await expect.element(rowOf('Teams')).toBeVisible()
    for (const name of [
      'General',
      'Sign-in and domains',
      'Integrations',
      'Storage and retention',
    ]) {
      expect(rowOf(name).elements()).toHaveLength(0)
    }
  })

  it('has no rows for a workspace the instance admin is not in, and says why', async () => {
    api({ member: false })
    await show()
    await expect.element(page.getByText("You're not a member of this workspace")).toBeVisible()
    // Only the way back and the breadcrumb: no page rows.
    expect(
      page
        .getByRole('link')
        .elements()
        .map((el) => el.textContent),
    ).toEqual(['Workspaces', 'Workspaces'])
  })

  it('says so for an address that is no workspace', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { body: { workspaces: [] } } })
    await show()
    await expect.element(page.getByText("This workspace doesn't exist")).toBeVisible()
  })

  describe('a deleted workspace', () => {
    it('shows its days left and restores it', async () => {
      let deleted = true
      const fake = fakeApi({
        'GET /api/instance/workspaces': () => ({
          body: {
            workspaces: [
              workspace(deleted ? { deletedAt: '2026-11-01T00:00:00.000Z', daysLeft: 22 } : {}),
            ],
          },
        }),
        'GET /api/workspaces/acme': {
          body: { canManage: true, isOwner: true, name: 'Acme', slug: 'acme', picture: null },
        },
        'POST /api/instance/workspaces/w1/restore': () => {
          deleted = false
          return { body: { workspace: workspace() } }
        },
      })
      await show()
      await expect.element(page.getByText('Deleted · 22 days left')).toBeVisible()
      expect(page.getByRole('link', { name: /^General/ }).elements()).toHaveLength(0)
      await page.getByRole('button', { name: 'Restore' }).click()
      await expect.poll(() => fake.of('POST')).toHaveLength(1)
      await expect.element(toastNamed('Restored Acme')).toBeVisible()
      await expect.element(rowOf('General')).toBeVisible()
    })

    it('deletes it for good once its address is typed', async () => {
      const fake = fakeApi({
        'GET /api/instance/workspaces': {
          body: {
            workspaces: [workspace({ deletedAt: '2026-11-01T00:00:00.000Z', daysLeft: 1 })],
          },
        },
        'POST /api/instance/workspaces/w1/purge': { status: 204 },
      })
      await show()
      await expect.element(page.getByText('Deleted · 1 day left')).toBeVisible()
      await page.getByRole('button', { name: 'Delete permanently' }).click()
      const confirm = page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Delete permanently' })
      await expect.element(confirm).toBeDisabled()
      await page.getByRole('alertdialog').getByRole('textbox').fill('acme')
      await confirm.click()
      await expect.poll(() => fake.of('POST')).toHaveLength(1)
    })
  })

  it('stacks on a phone with rows at least 44px tall', async () => {
    api()
    await show([390, 844])
    await expect.element(rowOf('General')).toBeVisible()
    for (const el of page.getByRole('region', { name: 'Workspace' }).getByRole('link').elements()) {
      expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    }
  })
})
