import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

beforeEach(async () => {
  await page.viewport(1400, 900)
})

const NAME = 'checkout / payment'
const viewerTitle = () => page.getByRole('heading', { level: 2, name: NAME })
const popover = () => page.getByRole('dialog', { name: 'Comment on this region' })
const toggle = () => page.getByRole('group', { name: 'Dragging draws' })
const ignoreList = () => page.getByRole('list', { name: `Regions of ${NAME}` })
const build = () => page.getByRole('button', { name: /^Enlarge This build/ })

async function ready(canManage: boolean) {
  const api = fakeBuildApi(detail())
  api.canManage = canManage
  api.ignoreRegions = [
    {
      id: 'r1',
      name: NAME,
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      createdAt: new Date().toISOString(),
      createdBy: { id: 'u2', name: 'Dana Levi' },
    },
  ]
  await renderBuild()
  await expect.element(viewerTitle()).toBeVisible()
  // The test files are not served: give the images the size they would have.
  for (const label of [/^Baseline/, /^This build/]) {
    const image = page.getByRole('img', { name: label }).element()
    image.style.width = '400px'
    image.style.height = '300px'
  }
  return api
}

const drag = () =>
  userEvent.dragAndDrop(build(), build(), {
    // Clear of the ignore region at 10, 20 to 110, 70: a press on that one moves it.
    sourcePosition: { x: 150, y: 120 },
    targetPosition: { x: 300, y: 250 },
  })

describe('drawing ignore regions on the build page', () => {
  it('is not offered to members', async () => {
    await ready(false)
    expect(toggle().elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Ignore regions' }).elements()).toHaveLength(0)
  })

  it('offers owners and admins Comments (chosen) and Ignore regions', async () => {
    await ready(true)
    await expect.element(toggle()).toBeVisible()
    await expect
      .element(toggle().getByRole('button', { name: 'Comments' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(ignoreList().elements()).toHaveLength(0)
  })

  it('draws a comment region in Comments mode', async () => {
    const api = await ready(true)
    await drag()
    await expect.element(popover()).toBeVisible()
    expect(api.ignorePosts).toEqual([])
  })

  it("shows the screenshot's ignore regions in Ignore regions mode and hides the comment popover", async () => {
    await ready(true)
    await toggle().getByRole('button', { name: 'Ignore regions' }).click()
    await expect.element(ignoreList().getByText('100 x 50 at 10, 20')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Edit region 1' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Remove region 1' })).toBeVisible()
    await toggle().getByRole('button', { name: 'Comments' }).click()
    await expect.element(ignoreList()).not.toBeInTheDocument()
  })

  it('saves an ignore region drawn by dragging, through the ignore regions API', async () => {
    const api = await ready(true)
    await toggle().getByRole('button', { name: 'Ignore regions' }).click()
    await drag()
    await vi.waitFor(() => expect(api.ignorePosts).toHaveLength(1))
    expect(popover().elements()).toHaveLength(0)
    const posted = api.ignorePosts[0]
    expect(posted?.name).toBe(NAME)
    // Pixels of the 400 × 300 screenshot, which the page shows a little smaller.
    expect(Math.abs((posted?.x ?? 0) - 156)).toBeLessThan(8)
    expect(Math.abs((posted?.y ?? 0) - 120)).toBeLessThan(8)
    expect(Math.abs((posted?.width ?? 0) - 156)).toBeLessThan(10)
    expect(Math.abs((posted?.height ?? 0) - 130)).toBeLessThan(10)
    await expect.element(ignoreList().getByRole('listitem')).toHaveLength(2)
  })

  it('has no Add region button: dragging is how an ignore region is added', async () => {
    await ready(true)
    await toggle().getByRole('button', { name: 'Ignore regions' }).click()
    await expect.element(ignoreList()).toBeVisible()
    expect(page.getByRole('button', { name: 'Add region' }).elements()).toHaveLength(0)
  })
})
