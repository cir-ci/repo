import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { parseIgnoreRegionsSearch } from '#features/teams/ignore-regions-search.ts'
import { IgnoreRegionsPage } from '#features/teams/IgnoreRegionsPage.tsx'
import { fakeApi, type ReplyHandler, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

const API = '/api/teams/acme/web'
const NOW = new Date(Date.now() - 3_600_000).toISOString()
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

const region = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  createdAt: NOW,
  createdBy: { id: 'u1', name: 'Dana Levi' },
  ...over,
})

const snapshot = (name: string, regions: number, size = true) => ({
  name,
  regions,
  latest: {
    buildNumber: 148,
    sha256: `sha-${name.replace('/', '-')}`,
    width: size ? 1000 : null,
    height: size ? 500 : null,
  },
})

const list = (over: Record<string, unknown> = {}) => ({
  regions: [
    region(ID1, 'checkout/summary'),
    region(ID2, 'checkout/summary', { createdBy: null }),
    region('3', 'nav/header'),
  ],
  snapshots: [snapshot('checkout/summary', 2), snapshot('nav/header', 1)],
  ...over,
})

function api(listBody: unknown = list(), extra: Record<string, ReplyHandler> = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: {
      body: {
        canManage: true,
        settings: { name: 'Web App', defaultBranch: 'main' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [],
        webhookEvents: [],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
      },
    },
    [`GET ${API}/ignore-regions`]: { body: listBody },
    ...extra,
  })
}

const show = (url = '/acme/web/settings/ignore-regions') =>
  renderPage(<IgnoreRegionsPage />, {
    route: '/$workspace/$team/settings/ignore-regions',
    url,
    announcer: true,
    validateSearch: parseIgnoreRegionsSearch,
  })

describe('IgnoreRegionsPage', () => {
  it('groups regions by screenshot and shows the first with its regions, who added them and when', async () => {
    api()
    await show()
    const options = page.getByRole('listbox', { name: 'Screenshots with ignore regions' })
    await expect
      .element(options.getByRole('option', { name: /checkout\/summary/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(options.getByRole('option', { name: /nav\/header/ }))
      .toHaveAttribute('aria-selected', 'false')
    await expect.element(page.getByLabelText('2 regions')).toBeVisible()
    await expect.element(page.getByLabelText('1 region')).toBeVisible()
    const regions = page.getByRole('list', { name: 'Regions of checkout/summary' })
    await expect.element(regions.getByText(/Added by Dana Levi/)).toBeVisible()
    await expect.element(regions.getByText(/Added from the command line/)).toBeVisible()
    await expect
      .element(page.getByRole('img', { name: 'checkout/summary in build #148' }))
      .toHaveAttribute('src', '/api/files/sha-checkout-summary')
    expect(document.title).toBe('Ignore regions · web · CirCI')
  })

  it('opens the screenshot named in the address (Triage links here)', async () => {
    api()
    await show('/acme/web/settings/ignore-regions?name=nav%2Fheader')
    await expect
      .element(page.getByRole('option', { name: /nav\/header/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(page.getByRole('list', { name: 'Regions of nav/header' })).toBeVisible()
  })

  it('switches screenshot', async () => {
    api()
    await show()
    await page.getByRole('option', { name: /nav\/header/ }).click()
    await expect.element(page.getByRole('list', { name: 'Regions of nav/header' })).toBeVisible()
  })

  it('says so when there are no regions yet', async () => {
    api({ regions: [], snapshots: [] })
    await show()
    await expect.element(page.getByText('No ignore regions yet')).toBeVisible()
  })

  it('removes a region only after confirming', async () => {
    const fake = api(list(), { [`DELETE ${API}/ignore-regions/${ID1}`]: { status: 204 } })
    await show()
    // Newest first, and they were created at the same instant: the order is the list's own.
    const remove = page.getByRole('button', { name: /^Remove region/ }).first()
    await remove.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(fake.of('DELETE')).toHaveLength(0)
    await remove.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
    await expect
      .element(page.getByRole('status').filter({ hasText: /^Ignore region removed$/ }))
      .toBeVisible()
  })

  it('edits a region’s position and size, rejecting what isn’t whole numbers', async () => {
    const fake = api(
      list({
        regions: [region(ID1, 'checkout/summary')],
        snapshots: [snapshot('checkout/summary', 1)],
      }),
      {
        [`PATCH ${API}/ignore-regions/${ID1}`]: { body: region(ID1, 'checkout/summary') },
      },
    )
    await show()
    await page.getByRole('button', { name: 'Edit region 1' }).click()
    await expect.element(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue(100)
    await page.getByRole('spinbutton', { name: 'Width' }).fill('10.5')
    await page.getByRole('button', { name: 'Save region' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Use whole numbers')
    expect(fake.of('PATCH')).toHaveLength(0)
    await page.getByRole('spinbutton', { name: 'Width' }).fill('120')
    await page.getByRole('button', { name: 'Save region' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    expect(fake.of('PATCH')[0]?.body).toEqual({ x: 10, y: 20, width: 120, height: 50 })
  })

  it('draws a region by dragging and saves it in pixels', async () => {
    const fake = api(list(), {
      [`POST ${API}/ignore-regions`]: { status: 201, body: region('9', 'checkout/summary') },
    })
    await show()
    await page.getByRole('button', { name: 'Draw region' }).click()
    const layer = page.getByTestId('region-layer')
    // The test screenshot never loads; give the image box its size.
    const shot = page.getByRole('img', { name: /checkout\/summary in build/ }).element()
    shot.style.height = '300px'
    await userEvent.dragAndDrop(layer, layer, {
      sourcePosition: { x: 100, y: 60 },
      targetPosition: { x: 300, y: 120 },
    })
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toMatchObject({
      name: 'checkout/summary',
      x: expect.any(Number),
      width: expect.any(Number),
    })
  })

  it('can’t draw on a screenshot of unknown size', async () => {
    api(list({ snapshots: [snapshot('checkout/summary', 2, false), snapshot('nav/header', 1)] }))
    await show()
    await expect.element(page.getByRole('button', { name: 'Draw region' })).toBeDisabled()
  })

  it('shows a failed load and retries', async () => {
    const fake = api()
    fake.set(`GET ${API}/ignore-regions`, { status: 500, body: { error: 'db down' } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/ignore-regions`, { body: list() })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByRole('listbox')).toBeVisible()
  })
})
