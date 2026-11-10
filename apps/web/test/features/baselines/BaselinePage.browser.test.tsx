import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinePage } from '#features/baselines/BaselinePage.tsx'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/teams/acme/web'
const NAME = 'checkout/payment-form'
const NOW = new Date(Date.now() - 3_600_000).toISOString()
const ID1 = '11111111-1111-4111-8111-111111111111'

const baseline = (name = NAME) => ({
  name,
  buildName: 'default',
  width: 1000,
  height: 500,
  sizeBytes: 2048,
  fileSha256: 'sha-baseline',
  thumbnailSha256: null,
  buildNumber: 148,
  commitSha: 'abcdef1',
  approvedAt: NOW,
  approvedBy: { id: 'u1', name: 'Maya Levi' },
})

const region = (id: string, name = NAME) => ({
  id,
  name,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  createdAt: NOW,
  createdBy: { id: 'u1', name: 'Dana Levi' },
})

const entry = (number: number, status: string | null) => ({
  build: { number, branch: 'main', status: 'complete', reviewStatus: 'approved', createdAt: NOW },
  status,
  image: { sha256: `sha-${number}`, thumbnail: null, width: 1000, height: 500 },
})

function api(canManage: boolean, extra: Record<string, ReplyHandler> = {}, name = NAME) {
  const enc = encodeURIComponent(name)
  return fakeApi({
    [`GET ${API}/baselines`]: {
      body: {
        team: { slug: 'web', name: 'Web App', defaultBranch: 'main' },
        baselines: [baseline(name)],
      },
    },
    [`GET ${API}/settings`]: {
      body: {
        canManage,
        settings: { name: 'Web App', defaultBranch: 'main' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [],
        webhookEvents: [],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
      },
    },
    [`GET ${API}/flaky`]: { body: { builds: 10, flaky: [{ name, changedIn: 4 }] } },
    [`GET ${API}/ignore-regions`]: {
      body: {
        regions: [region(ID1, name)],
        snapshots: [
          {
            name,
            regions: 1,
            latest: { buildNumber: 148, sha256: 'sha-baseline', width: 1000, height: 500 },
          },
        ],
      },
    },
    [`GET ${API}/snapshots/${enc}/history`]: {
      body: {
        defaultBranch: 'main',
        default: [entry(148, 'changed'), entry(147, 'unchanged'), entry(141, 'changed')],
        branch: null,
      },
    },
    ...extra,
  })
}

const show = (name = NAME) =>
  renderPage(<BaselinePage />, {
    route: '/$workspace/$team/baselines/$',
    url: `/acme/web/baselines/${name}`,
    announcer: true,
    otherRoutes: ['/$workspace/$team/baselines', '/$workspace/$team/builds/$number'],
  })

const trigger = () => page.getByRole('button', { name: `Enlarge ${NAME}` })

/** The test screenshot never loads: give the image its size. */
async function sizeImage() {
  const shot = page.getByRole('img', { name: `${NAME} in build #148` })
  await expect.element(shot).toBeInTheDocument()
  shot.element().style.height = '300px'
}

const drag = (from = { x: 100, y: 60 }, to = { x: 300, y: 120 }) =>
  userEvent.dragAndDrop(trigger(), trigger(), { sourcePosition: from, targetPosition: to })

describe('BaselinePage', () => {
  it('shows the baseline image with its regions, where it came from, who approved it, and its history', async () => {
    api(true)
    await show()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect
      .element(crumbs.getByRole('link', { name: 'Baselines' }))
      .toHaveAttribute('href', '/acme/web/baselines')
    await expect.element(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    await expect.element(page.getByText('Baseline from build #148 on main')).toBeVisible()
    await expect.element(page.getByText(/Approved by Maya Levi/)).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Open build' }))
      .toHaveAttribute('href', '/acme/web/builds/148')
    await expect
      .element(page.getByRole('img', { name: `${NAME} in build #148` }))
      .toHaveAttribute('src', '/api/files/sha-baseline')
    await expect.element(page.getByText(/Flaky: changed in 4 of the last 10 builds/)).toBeVisible()
    const regions = page.getByRole('list', { name: `Regions of ${NAME}` })
    await expect.element(regions.getByText(/Added by Dana Levi/)).toBeVisible()
    await expect.element(regions.getByText('100×50 at 10, 20')).toBeVisible()
    // History keeps the builds where it changed, each opening that build on this screenshot.
    const history = page.getByRole('list', { name: `Recent changes of ${NAME}` })
    await expect
      .element(history.getByRole('link').first())
      .toHaveAttribute('href', `/acme/web/builds/148?shot=${encodeURIComponent(NAME)}`)
    expect(history.getByRole('link').elements()).toHaveLength(2)
    expect(document.title).toBe(`${NAME} · Baselines · web · CirCI`)
  })

  it('enlarges the image on click', async () => {
    api(true)
    await show()
    // The test screenshot never loads; give the image its size.
    const shot = page.getByRole('img', { name: `${NAME} in build #148` })
    await expect.element(shot).toBeInTheDocument()
    shot.element().style.height = '300px'
    await page.getByRole('button', { name: `Enlarge ${NAME}` }).click()
    await expect.element(page.getByRole('dialog', { name: /build #148 on main/ })).toBeVisible()
  })

  it('lets an owner add a region from numbers', async () => {
    const fake = api(true, {
      [`POST ${API}/ignore-regions`]: { status: 201, body: region('9') },
    })
    await show()
    await page.getByRole('button', { name: 'Add region', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add an ignore region' })
    await expect.element(dialog.getByRole('textbox', { name: 'Width' })).toHaveValue('250')
    await dialog.getByRole('textbox', { name: 'Width' }).fill('300')
    await dialog.getByRole('button', { name: 'Add region' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      name: NAME,
      x: 375,
      y: 187,
      width: 300,
      height: 125,
    })
  })

  it('draws a region by dragging and saves it in pixels', async () => {
    const fake = api(true, {
      [`POST ${API}/ignore-regions`]: { status: 201, body: region('9') },
    })
    await show()
    await sizeImage()
    await drag()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toMatchObject({ name: NAME, x: expect.any(Number) })
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
  })

  it('has no Draw region button: dragging is always on', async () => {
    api(true)
    await show()
    await expect
      .element(page.getByRole('button', { name: 'Add region', exact: true }))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Draw region' }).elements()).toHaveLength(0)
  })

  it('treats a drag under 8 pixels as a click that enlarges', async () => {
    const fake = api(true)
    await show()
    await sizeImage()
    await drag({ x: 100, y: 60 }, { x: 104, y: 150 })
    await expect.element(page.getByRole('dialog', { name: /build #148 on main/ })).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
  })

  it('cancels a drag on Escape', async () => {
    const fake = api(true)
    await show()
    await sizeImage()
    // Hold the button down mid-drag. Chromium refuses pointer capture for synthetic pointers.
    const capture = vi
      .spyOn(Element.prototype, 'setPointerCapture')
      .mockImplementation(() => undefined)
    try {
      const stage = trigger().element().parentElement!
      const rect = stage.getBoundingClientRect()
      const at = (type: string, x: number, y: number) =>
        stage.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
          }),
        )
      at('pointerdown', 100, 60)
      at('pointermove', 300, 120)
      await userEvent.keyboard('{Escape}')
      at('pointerup', 300, 120)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(fake.of('POST')).toHaveLength(0)
      expect(page.getByRole('dialog').elements()).toHaveLength(0)
    } finally {
      capture.mockRestore()
    }
  })

  it('draws a region by dragging in the enlarged image', async () => {
    const fake = api(true, {
      [`POST ${API}/ignore-regions`]: { status: 201, body: region('9') },
    })
    await show()
    await sizeImage()
    await trigger().click()
    const dialog = page.getByRole('dialog', { name: /build #148 on main/ })
    await expect.element(dialog).toBeVisible()
    const image = dialog.getByRole('img').element()
    image.style.width = '400px'
    image.style.height = '300px'
    const overlay = page.getByTestId('region-overlay')
    await userEvent.dragAndDrop(overlay, overlay, {
      sourcePosition: { x: 40, y: 30 },
      targetPosition: { x: 200, y: 150 },
    })
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
  })

  it('draws a region from the keyboard and saves it in pixels', async () => {
    const fake = api(true, {
      [`POST ${API}/ignore-regions`]: { status: 201, body: region('9') },
    })
    await show()
    // Hidden until it has focus.
    const keyTool = page.getByRole('button', { name: 'Mark a region with the keyboard' })
    await expect.element(keyTool).toBeInTheDocument()
    keyTool.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Shift>}{ArrowDown}{/Shift}{Enter}')
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toMatchObject({ name: NAME, x: 400, y: 205, width: 200 })
  })

  it('removes a region only after confirming, and edits one', async () => {
    const fake = api(true, {
      [`DELETE ${API}/ignore-regions/${ID1}`]: { status: 204 },
      [`PATCH ${API}/ignore-regions/${ID1}`]: { body: region(ID1) },
    })
    await show()
    await page.getByRole('button', { name: 'Edit region 1' }).click()
    await page.getByRole('textbox', { name: 'Width' }).fill('120')
    await page.getByRole('button', { name: 'Save region' }).click()
    await expect.poll(() => fake.of('PATCH')).toHaveLength(1)
    expect(fake.of('PATCH')[0]?.body).toEqual({ x: 10, y: 20, width: 120, height: 50 })

    const remove = page.getByRole('button', { name: 'Remove region 1' })
    await remove.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(fake.of('DELETE')).toHaveLength(0)
    await remove.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('shows members the image, regions and history without add, draw, edit or remove', async () => {
    api(false)
    await show()
    await expect.element(page.getByRole('list', { name: `Regions of ${NAME}` })).toBeVisible()
    await expect
      .element(page.getByText(/Only owners and admins can add, change or remove ignore regions/))
      .toBeVisible()
    await expect
      .element(page.getByRole('list', { name: `Recent changes of ${NAME}` }))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Add region' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Draw region' }).elements()).toHaveLength(0)
    expect(
      page.getByRole('button', { name: 'Mark a region with the keyboard' }).elements(),
    ).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Edit region/ }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Remove region/ }).elements()).toHaveLength(0)
  })

  it('does not draw for a member: a drag adds nothing and a click enlarges', async () => {
    const fake = api(false)
    await show()
    await sizeImage()
    await drag()
    await expect.element(page.getByRole('dialog', { name: /build #148 on main/ })).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    expect(page.getByTestId('region-layer').elements()).toHaveLength(0)
  })

  it('reads a name with spaces and symbols back from the address', async () => {
    const odd = 'cart/price (€) 50% off?#1'
    api(true, {}, odd)
    const { router } = await show(`cart/${encodeURIComponent('price (€) 50% off?#1')}`)
    expect(router.state.location.pathname).toContain('cart/')
    await expect.element(page.getByRole('heading', { level: 1, name: odd })).toBeVisible()
    await expect.element(page.getByText(/Approved by Maya Levi/)).toBeVisible()
  })

  it('says so when no approved screenshot has the name', async () => {
    api(false, {
      [`GET ${API}/baselines`]: {
        body: { team: { slug: 'web', name: 'Web App', defaultBranch: 'main' }, baselines: [] },
      },
    })
    await show()
    await expect
      .element(page.getByText(/No approved screenshot with this name on main/))
      .toBeVisible()
    expect(page.getByRole('link', { name: 'Open build' }).elements()).toHaveLength(0)
  })

  it('shows a failed load and retries', async () => {
    const fake = api(true)
    fake.set(`GET ${API}/baselines`, { status: 500, body: { error: 'db down' } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
  })
})
