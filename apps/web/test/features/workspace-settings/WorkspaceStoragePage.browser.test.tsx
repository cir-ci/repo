import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceStoragePage } from '#features/workspace-settings/WorkspaceStoragePage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const ROUTE = {
  route: '/workspaces/$workspace/settings/storage',
  url: '/workspaces/acme/settings/storage',
  otherRoutes: ['/workspaces/$workspace/settings/members'],
}
const team = (slug: string, name: string, bytes: number, retentionDays = 90) => ({
  slug,
  name,
  color: 'slate',
  icon: null,
  retentionDays,
  files: 10,
  bytes,
})
const usage = (over: object = {}) => ({
  canManage: true,
  totalBytes: 4_000_000,
  totalFiles: 1234,
  kinds: [
    { kind: 'screenshot', files: 1000, bytes: 3_000_000 },
    { kind: 'diff', files: 200, bytes: 600_000 },
    { kind: 'thumbnail', files: 1000, bytes: 100_000 },
    { kind: 'site', files: 34, bytes: 300_000, versions: 5 },
  ],
  teams: [team('docs', 'Docs', 1_000_000, 30), team('web', 'Web App', 3_000_000)],
  defaultRetentionDays: 90,
  ...over,
})
const NAME = {
  'GET /api/workspaces/acme': { body: { canManage: true, name: 'Acme Inc', slug: 'acme' } },
}
/** The `retentionDays` of a request body, which the fake receives as `unknown`. */
function daysIn(body: unknown): number {
  if (typeof body === 'object' && body !== null && 'retentionDays' in body) {
    if (typeof body.retentionDays === 'number') return body.retentionDays
  }
  throw new Error('no retentionDays in the request')
}
const days = () => page.getByRole('textbox', { name: 'Default retention in days' })

describe('WorkspaceStoragePage', () => {
  it('shows the total, each kind with its size, and teams by size with their retention', async () => {
    await page.viewport(1000, 1000)
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByRole('heading', { name: 'Storage used 4 MB' })).toBeVisible()
    const kinds = page.getByRole('region', { name: /^Storage used/ })
    await expect.element(kinds.getByText('Screenshots')).toBeVisible()
    await expect.element(kinds.getByText('3 MB')).toBeVisible()
    await expect.element(kinds.getByText('34 files, 5 versions')).toBeVisible()
    const teams = page.getByRole('region', { name: 'By team' })
    const links = teams.getByRole('link')
    await expect.element(links.first()).toHaveAccessibleName('Web App')
    await expect.element(links.last()).toHaveAccessibleName('Docs')
    await expect.element(teams.getByText('30 days')).toBeVisible()
    await expect.element(links.first()).toHaveAttribute('href', '/acme/web/settings')
    await expect.element(page.getByText('Acme Inc')).toBeVisible()
  })

  it('says so when nothing is stored', async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      ...NAME,
      'GET /api/workspaces/acme/storage': {
        body: usage({ teams: [], totalBytes: 0, totalFiles: 0, kinds: [] }),
      },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByText('Nothing stored yet')).toBeVisible()
  })

  it('saves the default retention, noting existing teams keep theirs', async () => {
    await page.viewport(1000, 1000)
    let retentionDays = 90
    const api = fakeApi({
      ...NAME,
      'GET /api/workspaces/acme/storage': () => ({
        body: usage({ defaultRetentionDays: retentionDays }),
      }),
      'PATCH /api/workspaces/acme/settings': (body) => {
        retentionDays = daysIn(body)
        return { body: { settings: { flakyBlocksMerge: true, retentionDays } } }
      },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByText('Existing teams keep their own setting.')).toBeVisible()
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect.element(save).toBeDisabled()
    await days().fill('30')
    await save.click()
    await expect.poll(() => api.of('PATCH')[0]?.body).toEqual({ retentionDays: 30 })
    await expect.element(days()).toHaveValue('30')
    await expect.element(save).toBeDisabled()
  })

  it('refuses a bad number of days without asking the server', async () => {
    await page.viewport(1000, 1000)
    const api = fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await days().fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByText(/whole number of days/)).toBeVisible()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('shows why a save was refused, and Discard restores the saved value', async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      ...NAME,
      'GET /api/workspaces/acme/storage': { body: usage() },
      'PATCH /api/workspaces/acme/settings': { status: 403, body: { error: 'Not allowed' } },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await days().fill('7')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Not allowed')
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(days()).toHaveValue('90')
  })

  it('sends members to Members instead of showing storage', async () => {
    await page.viewport(1000, 1000)
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage({ canManage: false }) } })
    const { router } = await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/members')
    expect(days().elements()).toHaveLength(0)
  })

  it('says the workspace doesn’t exist for a 404', async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      'GET /api/workspaces/acme/storage': { status: 404, body: { error: 'Workspace not found' } },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByText('This workspace doesn’t exist')).toBeVisible()
  })
})
