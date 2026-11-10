import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

beforeEach(async () => {
  await page.viewport(1400, 900)
})

const viewerTitle = () => page.getByRole('heading', { level: 2, name: 'checkout / payment' })
const popover = () => page.getByRole('dialog', { name: 'Comment on this region' })
const trigger = (name: 'Baseline' | 'This build') =>
  page.getByRole('button', { name: new RegExp(`^Enlarge ${name}`) })

const layers = () => page.getByTestId('region-layer').elements()

/** The test files are not served: give the images the size they would have. */
function sizeImages() {
  for (const name of [/^Baseline/, /^This build/]) {
    const image = page.getByRole('img', { name }).element()
    image.style.width = '400px'
    image.style.height = '300px'
  }
}

async function ready(api = fakeBuildApi(detail())) {
  await renderBuild()
  await expect.element(viewerTitle()).toBeVisible()
  sizeImages()
  return api
}

/** The keyboard way in: focus the (otherwise hidden) button and press Enter. */
async function startKeyboardTool() {
  page.getByRole('button', { name: 'Mark a region with the keyboard' }).element().focus()
  await userEvent.keyboard('{Enter}')
}

const drag = (name: 'Baseline' | 'This build', from = { x: 40, y: 30 }, to = { x: 200, y: 150 }) =>
  userEvent.dragAndDrop(trigger(name), trigger(name), {
    sourcePosition: from,
    targetPosition: to,
  })

const enlarged = () => page.getByRole('dialog', { name: 'Baseline · build #6 on main' })
const overlay = () => page.getByTestId('region-overlay')

async function enlargeBaseline() {
  await trigger('Baseline').click()
  await expect.element(enlarged()).toBeVisible()
  const image = enlarged().getByRole('img').element()
  image.style.width = '400px'
  image.style.height = '300px'
}

const dragInDialog = () =>
  userEvent.dragAndDrop(overlay(), overlay(), {
    sourcePosition: { x: 40, y: 30 },
    targetPosition: { x: 200, y: 150 },
  })

describe('region comments in the enlarged view', () => {
  it('a drag opens the focused popover; Send posts the side drawn on, and the pin shows inline too', async () => {
    const api = await ready()
    await enlargeBaseline()
    await dragInDialog()
    const box = popover().getByRole('combobox', { name: 'Comment' })
    await expect.element(box).toHaveFocus()
    await expect.element(popover().getByText('Comment on this region')).toBeVisible()
    // One comment box at a time: the inline image shows none while the dialog is open.
    expect(popover().elements()).toHaveLength(1)
    const send = popover().getByRole('button', { name: /^Send/ })
    await expect.element(send).toBeDisabled()
    // Arrow keys belong to the box while it has focus: no image switch.
    await userEvent.keyboard('{ArrowRight}Wrong colour')
    await expect.element(enlarged()).toBeVisible()
    await send.click()
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    expect(api.commentPosts[0]?.regionSide).toBe('baseline')
    expect(api.commentPosts[0]?.region?.x).toBeCloseTo(0.1, 1)
    // The pin is in the dialog and, once it is closed, on the inline baseline image.
    await expect.element(enlarged().getByRole('button', { name: 'Comment 1' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(enlarged()).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Comment 1' })).toBeVisible()
  })

  it('Esc cancels the selection first; the next Esc closes the dialog', async () => {
    await ready()
    await enlargeBaseline()
    await dragInDialog()
    await expect.element(popover()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(popover()).not.toBeInTheDocument()
    await expect.element(enlarged()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(enlarged()).not.toBeInTheDocument()
  })

  it('Esc in the middle of a drag cancels the drag and keeps the dialog open', async () => {
    await ready()
    await enlargeBaseline()
    // Hold the button down mid-drag. Chromium refuses pointer capture for synthetic pointers.
    const capture = vi
      .spyOn(Element.prototype, 'setPointerCapture')
      .mockImplementation(() => undefined)
    try {
      const layer = overlay().element()
      const rect = layer.getBoundingClientRect()
      const at = (type: string, x: number, y: number) =>
        layer.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
          }),
        )
      at('pointerdown', 40, 30)
      at('pointermove', 200, 150)
      await userEvent.keyboard('{Escape}')
      await expect.element(enlarged()).toBeVisible()
      at('pointerup', 200, 150)
      await expect.element(popover()).not.toBeInTheDocument()
    } finally {
      capture.mockRestore()
    }
  })

  it('a plain click in the dialog neither closes it nor starts a region', async () => {
    await ready()
    await enlargeBaseline()
    await overlay().click({ position: { x: 50, y: 50 } })
    await expect.element(enlarged()).toBeVisible()
    expect(popover().elements()).toHaveLength(0)
  })
})

describe('region comments are always on', () => {
  it('has no toggle, says how to comment, and offers the keyboard way', async () => {
    await ready()
    expect(page.getByRole('button', { name: 'Comment on a region' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('Drag on an image to comment on a region')).toBeVisible()
    // The toolbar shows no icon for it (the board has none): it appears only while it has focus.
    const key = page.getByRole('button', { name: 'Mark a region with the keyboard' })
    // Clipped to a pixel by its wrapper until focused.
    expect(key.element().parentElement?.getBoundingClientRect().width).toBeLessThanOrEqual(1)
    key.element().focus()
    await expect.element(key).toBeVisible()
    expect(key.element().parentElement?.getBoundingClientRect().width).toBeGreaterThan(16)
  })

  it('a drag selects a region: the popover opens with focus in its box, and Send needs text', async () => {
    const api = await ready()
    await drag('This build')
    const box = popover().getByRole('combobox', { name: 'Comment' })
    await expect.element(box).toHaveFocus()
    // The board's header row: the signed-in user's avatar and what the box is for.
    await expect.element(popover().getByText('Comment on this region')).toBeVisible()
    await expect.element(popover().getByRole('img', { name: 'Ada Lovelace' })).toBeVisible()
    const send = popover().getByRole('button', { name: /^Send/ })
    await expect.element(send).toBeDisabled()
    await userEvent.keyboard('Padding is wrong here')
    await expect.element(send).toBeEnabled()
    expect(popover().element().getBoundingClientRect().width).toBe(232)

    await send.click()
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    const [posted] = api.commentPosts
    expect(posted?.body).toBe('Padding is wrong here')
    expect(posted?.snapshotName).toBe('checkout / payment')
    expect(posted?.region?.x).toBeCloseTo(0.1, 1)
    expect(posted?.region?.y).toBeCloseTo(0.1, 1)
    expect(posted?.region?.width).toBeCloseTo(0.4, 1)
    expect(posted?.region?.height).toBeCloseTo(0.4, 1)

    // The region is now a numbered pin, and its marker brings the comment into focus.
    const marker = page.getByRole('button', { name: 'Comment 1' })
    await expect.element(marker).toBeVisible()
    await expect.element(popover()).not.toBeInTheDocument()
    // The pin is a teardrop at the region's top-right corner, not a tab at its top-left.
    const markerBox = marker.element().getBoundingClientRect()
    const pin = marker.element().querySelector('span')!
    const pinBox = pin.getBoundingClientRect()
    expect(getComputedStyle(pin).borderRadius).toBe('50% 50% 50% 0px')
    expect(Math.abs(pinBox.left + pinBox.width / 2 - markerBox.right)).toBeLessThan(4)
    expect(Math.abs(pinBox.top + pinBox.height / 2 - markerBox.top)).toBeLessThan(4)
    await marker.click()
    await expect
      .element(page.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('sends with ⌘↵ and cancels with Esc, dropping the draft', async () => {
    const api = await ready()
    await drag('This build')
    await userEvent.keyboard('first thought')
    await userEvent.keyboard('{Escape}')
    await expect.element(popover()).not.toBeInTheDocument()
    expect(api.commentPosts).toEqual([])

    await drag('This build')
    await expect.element(popover().getByRole('combobox')).toHaveValue('')
    await userEvent.keyboard('second thought')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await vi.waitFor(() => expect(api.commentPosts.map((c) => c.body)).toEqual(['second thought']))
  })

  it('a click without a drag opens the enlarged view instead, and arrows switch images', async () => {
    await ready()
    await trigger('This build').click()
    const dialog = page.getByRole('dialog', { name: 'This build · 0123456' })
    await expect.element(dialog).toBeVisible()
    expect(popover().elements()).toHaveLength(0)
    await userEvent.keyboard('{ArrowLeft}')
    await expect
      .element(page.getByRole('dialog', { name: 'Baseline · build #6 on main' }))
      .toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('dialog', { name: 'This build · 0123456' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('a drag shorter than 8 pixels is a click', async () => {
    await ready()
    await drag('Baseline', { x: 40, y: 30 }, { x: 44, y: 150 })
    await expect
      .element(page.getByRole('dialog', { name: 'Baseline · build #6 on main' }))
      .toBeVisible()
    expect(popover().elements()).toHaveLength(0)
  })

  it('keeps a region on the side it was drawn on', async () => {
    await ready()
    await drag('Baseline')
    await expect.element(popover()).toBeVisible()
    const owner = popover().element().closest('figure')
    expect(owner?.textContent).toContain('Baseline')
    expect(page.getByTestId('region-layer').elements()).toHaveLength(2)
    expect(
      page.getByTestId('region-layer').elements()[1]?.querySelector('[data-pending]'),
    ).toBeNull()
  })

  it('a comment drawn on the baseline pins on the baseline image only', async () => {
    const api = await ready()
    await drag('Baseline')
    await expect.element(popover().getByRole('combobox', { name: 'Comment' })).toHaveFocus()
    await userEvent.keyboard('Wrong colour here')
    await popover().getByRole('button', { name: /^Send/ }).click()
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    expect(api.commentPosts[0]?.regionSide).toBe('baseline')
    await expect.element(page.getByRole('button', { name: 'Comment 1' })).toBeVisible()
    // Two images, two layers (baseline first): the pin is on the first only.
    expect(layers()[0]?.querySelectorAll('button')).toHaveLength(1)
    expect(layers()[1]?.querySelectorAll('button')).toHaveLength(0)
  })

  it('drops the selection when another screenshot is chosen, and it stays gone on return', async () => {
    await ready()
    await drag('This build')
    await expect.element(popover()).toBeVisible()
    await page.getByRole('link', { name: /checkout \/ address/ }).click()
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'checkout / address' }))
      .toBeVisible()
    await expect.element(popover()).not.toBeInTheDocument()
    await page.getByRole('link', { name: /checkout \/ payment/ }).click()
    await expect.element(viewerTitle()).toBeVisible()
    await expect.element(popover()).not.toBeInTheDocument()
  })

  it('places a region from the keyboard: arrows move, Enter confirms into the popover', async () => {
    const api = await ready()
    await startKeyboardTool()
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}')
    await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowDown}{/Shift}')
    await userEvent.keyboard('{Enter}')
    await expect.element(popover().getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('Too tight')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    const region = api.commentPosts[0]?.region
    expect(region?.x).toBeCloseTo(0.42, 3)
    expect(region?.y).toBeCloseTo(0.41, 3)
    expect(region?.width).toBeCloseTo(0.22, 3)
    expect(region?.height).toBeCloseTo(0.21, 3)
  })

  it('cancels the keyboard region with Escape and returns focus to the button', async () => {
    await ready()
    const toggle = page.getByRole('button', { name: 'Mark a region with the keyboard' })
    await startKeyboardTool()
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByRole('group', { name: 'Region to mark' }))
      .not.toBeInTheDocument()
    await expect.element(toggle).toHaveFocus()
    await expect.element(page.getByText('Region cancelled')).toBeInTheDocument()
  })
})

describe('@mentions in the region popover', () => {
  const max = { id: 'm3', userId: 'u3', user: { name: 'Max Member', email: 'member@example.test' } }

  async function openWithMembers() {
    const api = fakeBuildApi(detail())
    api.members = [max]
    await ready(api)
    await drag('This build')
    const box = popover().getByRole('combobox', { name: 'Comment' })
    await expect.element(box).toHaveFocus()
    return { api, box }
  }

  it('suggests members after @, inserts the pick with Enter, and posts the handle', async () => {
    const { api, box } = await openWithMembers()
    await userEvent.keyboard('Check this @ma')
    await expect.element(popover().getByRole('option', { name: /Max Member/ })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.element(box).toHaveValue('Check this @member ')
    // The pick is not a send.
    expect(api.commentPosts).toEqual([])
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    expect(api.commentPosts[0]?.body).toBe('Check this @member')
  })

  it('Esc closes the picker first; the next Esc cancels the popover', async () => {
    await openWithMembers()
    await userEvent.keyboard('@ma')
    await expect.element(popover().getByRole('option', { name: /Max Member/ })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(popover()).toBeVisible()
    expect(page.getByRole('option').elements()).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    await expect.element(popover()).not.toBeInTheDocument()
  })
})
