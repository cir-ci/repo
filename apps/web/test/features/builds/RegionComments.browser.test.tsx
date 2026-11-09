import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

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

const drag = (name: 'Baseline' | 'This build', from = { x: 40, y: 30 }, to = { x: 200, y: 150 }) =>
  userEvent.dragAndDrop(trigger(name), trigger(name), {
    sourcePosition: from,
    targetPosition: to,
  })

describe('region comments are always on', () => {
  it('has no toggle, says how to comment, and offers the keyboard way', async () => {
    await ready()
    expect(page.getByRole('button', { name: 'Comment on a region' }).elements()).toHaveLength(0)
    await expect
      .element(
        page.getByText('Drag on an image to comment on a region · click an image to enlarge'),
      )
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Mark a region with the keyboard' }))
      .toBeVisible()
  })

  it('a drag selects a region: the popover opens with focus in its box, and Send needs text', async () => {
    const api = await ready()
    await drag('This build')
    const box = popover().getByRole('textbox', { name: 'Comment' })
    await expect.element(box).toHaveFocus()
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
    await expect.element(popover().getByRole('textbox')).toHaveValue('')
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
    await expect.element(popover().getByRole('textbox', { name: 'Comment' })).toHaveFocus()
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
    await page.getByRole('button', { name: 'Mark a region with the keyboard' }).click()
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}')
    await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowDown}{/Shift}')
    await userEvent.keyboard('{Enter}')
    await expect.element(popover().getByRole('textbox')).toHaveFocus()
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
    await toggle.click()
    await expect.element(page.getByRole('group', { name: 'Region to mark' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect
      .element(page.getByRole('group', { name: 'Region to mark' }))
      .not.toBeInTheDocument()
    await expect.element(toggle).toHaveFocus()
    await expect.element(page.getByText('Region cancelled')).toBeInTheDocument()
  })
})
