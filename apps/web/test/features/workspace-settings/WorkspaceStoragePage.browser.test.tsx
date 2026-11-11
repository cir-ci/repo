import { AppFrame } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { WorkspaceStoragePage } from '#features/workspace-settings/WorkspaceStoragePage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const ROUTE = {
  route: '/workspaces/$workspace/settings/storage',
  url: '/workspaces/acme/settings/storage',
  otherRoutes: ['/workspaces/$workspace/settings/members', '/$workspace/$project/settings/general'],
}
const project = (slug: string, name: string, bytes: number, retentionDays = 90) => ({
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
  projects: [project('docs', 'Docs', 1_000_000, 30), project('web', 'Web App', 3_000_000)],
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
  it('shows the total, each kind with its size, and projects by size with their retention', async () => {
    await page.viewport(1000, 1000)
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByRole('heading', { name: 'Storage used 4 MB' })).toBeVisible()
    const kinds = page.getByRole('region', { name: /^Storage used/ })
    await expect.element(kinds.getByText('Screenshots')).toBeVisible()
    await expect.element(kinds.getByText('3 MB')).toBeVisible()
    await expect.element(kinds.getByText('34 files, 5 versions')).toBeVisible()
    const projects = page.getByRole('region', { name: 'By project' })
    const links = projects.getByRole('link')
    await expect.element(links.first()).toHaveAccessibleName('Web App')
    await expect.element(links.last()).toHaveAccessibleName('Docs')
    await expect.element(projects.getByText('30 days')).toBeVisible()
    // Each project opens its retention setting, which the General page holds.
    await expect
      .element(links.first())
      .toHaveAttribute('href', '/acme/web/settings/general#retention')
    await expect
      .element(links.last())
      .toHaveAttribute('href', '/acme/docs/settings/general#retention')
    await expect.element(page.getByText('Acme Inc')).toBeVisible()
  })

  it('says so when nothing is stored', async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      ...NAME,
      'GET /api/workspaces/acme/storage': {
        body: usage({ projects: [], totalBytes: 0, totalFiles: 0, kinds: [] }),
      },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expectEmptyState('Nothing stored yet', { body: 'Upload a build to see its size here.' })
  })

  it('saves the default retention, noting existing projects keep theirs', async () => {
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
    await expect.element(page.getByText('Existing projects keep their own setting.')).toBeVisible()
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

  it("says the workspace doesn't exist for a 404", async () => {
    await page.viewport(1000, 1000)
    fakeApi({
      'GET /api/workspaces/acme/storage': { status: 404, body: { error: 'Workspace not found' } },
    })
    await renderPage(<WorkspaceStoragePage />, ROUTE)
    await expect.element(page.getByText("This workspace doesn't exist")).toBeVisible()
  })
})

const framed = (width: number) => (
  <AppFrame sidebar={<span>Side</span>} compact={width < 820}>
    <WorkspaceStoragePage />
  </AppFrame>
)

describe('WorkspaceStoragePage By project and the days field', () => {
  it.each([390, 1280])(
    'puts the size bar before the days, and keeps the days field compact, at %ipx',
    async (width) => {
      fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
      await renderPage(framed(width), { ...ROUTE, viewport: [width, 2400] })
      const projects = page.getByRole('region', { name: 'By project' })
      await expect.element(projects.getByText('1 MB')).toBeVisible()
      const bytes = projects.getByText('1 MB').element()
      const retention = projects.getByText('30 days').element()
      // The bar and the size come first in the row; the days after them (never above the bar).
      expect(
        bytes.compareDocumentPosition(retention) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(Math.round(retention.getBoundingClientRect().top)).toBeGreaterThanOrEqual(
        Math.round(bytes.getBoundingClientRect().top),
      )
      // About four digits and the unit, not a form-wide field.
      const field = days().element().closest('[data-hide-label]')
      expect(field?.getBoundingClientRect().width).toBeLessThanOrEqual(150)
    },
  )
})

describe('WorkspaceStoragePage in the app frame', () => {
  // The page is shorter than the window: nothing in the frame adds a scroll, up or sideways.
  it.each([
    [390, 2400],
    [1280, 2400],
  ] as [number, number][])('does not scroll at %ix%i', async (width, height) => {
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    await renderPage(framed(width), { ...ROUTE, viewport: [width, height] })
    await expect.element(page.getByRole('heading', { name: 'Storage used 4 MB' })).toBeVisible()
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('ends at the pinned Save bar on a phone: scrolled to the bottom, the bar has not moved', async () => {
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    await renderPage(framed(390), { ...ROUTE, viewport: [390, 600] })
    await userEvent.type(days(), '1')
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect.element(save).toBeVisible()
    const bar = () => save.element().parentElement!.getBoundingClientRect()
    expect(Math.round(bar().bottom)).toBe(window.innerHeight)
    window.scrollTo(0, document.documentElement.scrollHeight)
    await expect
      .poll(() => window.scrollY + window.innerHeight)
      .toBe(document.documentElement.scrollHeight)
    // Nothing is left to scroll past the bar, so it stays on the window's bottom edge.
    expect(Math.round(bar().bottom)).toBe(window.innerHeight)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })
})

describe('WorkspaceStoragePage By project link', () => {
  it('goes to the project’s retention setting', async () => {
    await page.viewport(1000, 1000)
    fakeApi({ ...NAME, 'GET /api/workspaces/acme/storage': { body: usage() } })
    const { router } = await renderPage(<WorkspaceStoragePage />, ROUTE)
    await page
      .getByRole('region', { name: 'By project' })
      .getByRole('link', { name: 'Web App' })
      .click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings/general')
    expect(router.state.location.hash).toBe('retention')
  })
})
