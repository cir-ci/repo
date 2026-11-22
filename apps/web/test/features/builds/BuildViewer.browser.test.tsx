import { beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { useSingleKeyStore } from '#lib/stores/single-key-store.ts'
import { settled } from '#test/support/settled.ts'

import { detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

// The build review reads the session (avatar, reviewer picker): the fake client, signed in as
// Ada, so better-auth's own session store never refetches outside a test's fake.
beforeEach(async () => {
  await page.viewport(1280, 900)
})

// The viewer's title: the heading its section is labelled by. A toast's title is a level-2 heading
// too, so asking for the last (or first) one in the page found an open toast's, and each check
// waited for the toast to close (5 s).
const viewerTitle = () =>
  page.getByRole('region', { name: /^(?!Notifications$)/ }).getByRole('heading', { level: 2 })

describe('view modes', () => {
  it('defaults to side by side and follows ?mode=', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect
      .element(page.getByRole('button', { name: 'Side by side' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('img', { name: /^This build: / })).toBeVisible()
  })

  it('switches mode through the search params', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    expect(page.getByRole('button', { name: 'Overlay' }).elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Diff', exact: true }).click()
    await expect.poll(() => router.state.location.search).toMatchObject({ mode: 'diff' })
    // The changed pixels with this build under them, and the pill that fades one into the other.
    await expect
      .element(page.getByRole('img', { name: 'This build: checkout / payment' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('img', { name: 'Changed pixels: checkout / payment' }))
      .toBeVisible()
    await expect.element(page.getByRole('slider', { name: 'This build' })).toBeVisible()
    await page.getByRole('button', { name: 'Slider' }).click()
    await expect.poll(() => router.state.location.search).toMatchObject({ mode: 'slider' })
    await expect
      .element(page.getByRole('img', { name: 'Baseline: checkout / payment' }))
      .toBeVisible()
  })

  it('puts the divider on the image: the handle is a slider with its range and a label', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    const slider = page.getByRole('slider', { name: 'Slider position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    await expect.element(slider).toHaveAttribute('min', '0')
    await expect.element(slider).toHaveAttribute('max', '100')
    // Not in the toolbar any more: it is inside the figure, over the images.
    const figure = page.getByRole('figure').filter({ has: page.getByRole('slider') })
    await expect.element(figure).toBeVisible()
    expect(page.getByRole('slider', { name: 'Slider position' }).elements()).toHaveLength(1)
  })

  it('moves the slider divider with the keyboard', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    const slider = page.getByRole('slider', { name: 'Slider position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    const head = page.getByRole('img', { name: 'This build: checkout / payment' })
    await expect.element(head).toHaveStyle({ clipPath: 'inset(0px 0px 0px 50%)' })
    slider.element().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '52')
    await expect.element(head).toHaveStyle({ clipPath: 'inset(0px 0px 0px 52%)' })
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '51')
    await userEvent.keyboard('{Home}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '0')
    await userEvent.keyboard('{End}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('moves the divider only by dragging the handle', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    const slider = page.getByRole('slider', { name: 'Slider position' })
    const head = page.getByRole('img', { name: 'This build: checkout / payment' })
    await expect.element(head).toBeVisible()
    const box = head.element().getBoundingClientRect()
    const y = box.top + box.height * 0.2
    // The handle is at 50%: press on its line, drag to 80%.
    const target = document.elementFromPoint(box.left + box.width * 0.5, y)
    expect(target).not.toBeNull()
    expect(slider.element().parentElement?.contains(target)).toBe(true)
    pointerDrag(target, 'mouse', { x: box.left + box.width * 0.5, y }, box.left + box.width * 0.8)
    await expect.poll(() => slider.element().getAttribute('aria-valuenow')).not.toBe('50')
    const now = Number(slider.element().getAttribute('aria-valuenow'))
    expect(now).toBeGreaterThan(70)
    expect(now).toBeLessThanOrEqual(85)
    await expect.element(head).toHaveStyle({ clipPath: `inset(0px 0px 0px ${now}%)` })
  })

  it('draws a region by dragging elsewhere on the image, and a click leaves the divider', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    const slider = page.getByRole('slider', { name: 'Slider position' })
    const head = page.getByRole('img', { name: 'This build: checkout / payment' })
    await expect.element(head).toBeVisible()
    // The test images don't load: give the frame a size to draw on.
    const base = page.getByRole('img', { name: 'Baseline: checkout / payment' }).element()
    base.style.width = '400px'
    base.style.height = '300px'
    const handle = slider.element()
    const layer = page.getByTestId('region-layer')
    await userEvent.click(layer, { position: { x: 30, y: 30 } })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    await userEvent.dragAndDrop(layer, layer, {
      sourcePosition: { x: 20, y: 20 },
      targetPosition: { x: 120, y: 90 },
    })
    await expect.element(page.getByRole('dialog', { name: 'Comment on this region' })).toBeVisible()
    // (The page behind the box is out of the accessibility tree while it traps focus.)
    expect(handle.getAttribute('aria-valuenow')).toBe('50')
  })
})

function pointerDrag(
  target: Element | null,
  pointerType: 'mouse' | 'touch',
  from: { x: number; y: number },
  toX: number,
) {
  const fire = (type: string, x: number) =>
    (type === 'pointerdown' ? target : document)?.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1,
        pointerType,
        isPrimary: true,
        clientX: x,
        clientY: from.y,
      }),
    )
  fire('pointerdown', from.x)
  fire('pointermove', toX)
  fire('pointerup', toX)
}

const layerOf = () => page.getByRole('img', { name: 'Changed pixels: checkout / payment' })

async function opened() {
  fakeBuildApi(detail())
  await renderBuild('/acme/web-app/builds/7?mode=diff')
  await expect.element(layerOf()).toBeVisible()
}

describe('diff mode: this build under the changed pixels', () => {
  it('keeps the slider on the image, named, not in the toolbar', async () => {
    await opened()
    const slider = page.getByRole('slider', { name: 'This build' })
    // Diff starts as it always was: the changed pixels alone.
    await expect.element(slider).toHaveAttribute('aria-valuenow', '0')
    await expect.element(layerOf()).toHaveStyle({ opacity: '1' })
    expect(slider.element().closest('figure')).not.toBeNull()
    // The pill says what it controls in words, not only to assistive technology.
    await expect.element(page.getByText('This build', { exact: true })).toBeVisible()
    expect(page.getByRole('slider').elements()).toHaveLength(1)
    const toolbar = page.getByRole('group', { name: 'View' }).element().parentElement
    expect(toolbar?.querySelector('[role="slider"]')).toBeNull()
  })

  it('keeps the pill readable at rest: not faded below 0.9', async () => {
    await opened()
    const pill = page
      .getByRole('slider', { name: 'This build' })
      .element()
      .closest('div[class*="pill"]')
    if (!pill) throw new Error('no pill')
    expect(Number(getComputedStyle(pill).opacity)).toBeGreaterThanOrEqual(0.9)
  })

  it("enlarges the diff at the pill's opacity, with the changed pixels over this build", async () => {
    await opened()
    await userEvent.keyboard(']')
    // The fake images don't load, so the frame is a few pixels tall and the pill covers it: press it directly.
    page
      .getByRole('button', { name: 'Enlarge Diff' })
      .element()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const dialog = page.getByRole('dialog', { name: 'Changed pixels' })
    await expect.element(dialog).toBeVisible()
    const cover = dialog.element().querySelector('img[alt=""]')
    expect(cover).not.toBeNull()
    expect(cover && getComputedStyle(cover).opacity).toBe('0.9')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('shows more of the build as the slider moves', async () => {
    await opened()
    page.getByRole('slider', { name: 'This build' }).element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(layerOf()).toHaveStyle({ opacity: '0.95' })
    await expect.element(page.getByText('5%')).toBeVisible()
  })

  it('steps by 10% with [ and ], within 0 and 100, and says so', async () => {
    await opened()
    await userEvent.keyboard(']')
    await expect.element(layerOf()).toHaveStyle({ opacity: '0.9' })
    await expect.element(page.getByText('This build 10%')).toBeInTheDocument()
    // (`[[` is how the keyboard syntax types one `[`.)
    await userEvent.keyboard('[[')
    await userEvent.keyboard('[[')
    await expect.element(layerOf()).toHaveStyle({ opacity: '1' })
    await userEvent.keyboard(']]]]]]]]]]]]')
    await expect.element(layerOf()).toHaveStyle({ opacity: '0' })
    await expect
      .element(page.getByRole('slider', { name: 'This build' }))
      .toHaveAttribute('aria-valuenow', '100')
  })

  it('steps with [ and ] while the pill slider has focus', async () => {
    await opened()
    page.getByRole('slider', { name: 'This build' }).element().focus()
    await userEvent.keyboard(']')
    await expect
      .element(page.getByRole('slider', { name: 'This build' }))
      .toHaveAttribute('aria-valuenow', '10')
  })

  it('treats ] typed with Alt held (a layout that needs Option) as the key, not a peek', async () => {
    await opened()
    await userEvent.keyboard('{Alt>}]')
    await expect
      .element(page.getByRole('slider', { name: 'This build' }))
      .toHaveAttribute('aria-valuenow', '10')
    // Not a peek: the layer follows the value (0.9), not the build in full (0).
    await settled()
    await expect.element(layerOf()).toHaveStyle({ opacity: '0.9' })
    await userEvent.keyboard('{/Alt}')
  })

  it('shows the build in full while Alt is held on its own, then restores it', async () => {
    await opened()
    await userEvent.keyboard('{Alt>}')
    await expect.element(layerOf()).toHaveStyle({ opacity: '0' })
    await userEvent.keyboard('{/Alt}')
    await expect.element(layerOf()).toHaveStyle({ opacity: '1' })
    await expect
      .element(page.getByRole('slider', { name: 'This build' }))
      .toHaveAttribute('aria-valuenow', '0')
  })

  it('does not draw a region from a press on the pill, but does elsewhere on the image', async () => {
    await opened()
    const head = page.getByRole('img', { name: 'This build: checkout / payment' }).element()
    head.style.width = '400px'
    head.style.height = '300px'
    const slider = page.getByRole('slider', { name: 'This build' })
    const pill = slider.element().closest('div[class*="pill"]')
    expect(pill).not.toBeNull()
    const box = pill?.getBoundingClientRect()
    if (!box) throw new Error('no pill')
    pointerDrag(pill, 'mouse', { x: box.left + 6, y: box.top + 6 }, box.left - 80)
    expect(page.getByRole('dialog', { name: 'Comment on this region' }).elements()).toHaveLength(0)
    const layer = page.getByTestId('region-layer')
    await userEvent.dragAndDrop(layer, layer, {
      sourcePosition: { x: 20, y: 20 },
      targetPosition: { x: 120, y: 90 },
    })
    await expect.element(page.getByRole('dialog', { name: 'Comment on this region' })).toBeVisible()
  })
})

const headOf = () => page.getByRole('img', { name: 'This build: checkout / payment' })

const handle = () => page.getByRole('slider', { name: 'Slider position' })

async function openSlider() {
  fakeBuildApi(detail())
  await renderBuild('/acme/web-app/builds/7?mode=slider')
  await expect.element(handle()).toHaveAttribute('aria-valuenow', '50')
}

describe('slider mode: the same keys as Diff', () => {
  it('steps this build by 10% with [ and ] (] shows more of it) and says so', async () => {
    await openSlider()
    await userEvent.keyboard(']')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '40')
    await expect.element(headOf()).toHaveStyle({ clipPath: 'inset(0px 0px 0px 40%)' })
    await expect.element(page.getByText('This build 60%')).toBeInTheDocument()
    await userEvent.keyboard('[[')
    await userEvent.keyboard('[[')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '60')
    await expect.element(page.getByText('This build 40%')).toBeInTheDocument()
    await userEvent.keyboard(']]]]]]]]]]]]')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '0')
  })

  it('steps with [ and ] while the handle has focus, and arrow keys still move it', async () => {
    await openSlider()
    handle().element().focus()
    await userEvent.keyboard(']')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '40')
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '41')
  })

  it('shows this build in full while Alt is held on its own, then restores the position', async () => {
    await openSlider()
    await userEvent.keyboard(']')
    await userEvent.keyboard('{Alt>}')
    await expect.element(headOf()).toHaveStyle({ clipPath: 'inset(0px 0px 0px 0%)' })
    await userEvent.keyboard('{/Alt}')
    await expect.element(headOf()).toHaveStyle({ clipPath: 'inset(0px 0px 0px 40%)' })
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '40')
  })

  it('leaves [ and ] alone when single-key shortcuts are off', async () => {
    await openSlider()
    useSingleKeyStore.getState().setEnabled(false)
    try {
      await userEvent.keyboard(']')
      handle().element().focus()
      await userEvent.keyboard(']')
      await expect.element(handle()).toHaveAttribute('aria-valuenow', '50')
    } finally {
      useSingleKeyStore.getState().setEnabled(true)
    }
  })

  it('does the same on a phone', async () => {
    await page.viewport(390, 800)
    fakeBuildApi(detail())
    await renderBuild()
    // The phone's view tabs: Slider is one of them, and its handle takes the same keys.
    await page.getByRole('button', { name: 'Slider', exact: true }).click()
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '50')
    await userEvent.keyboard(']')
    await expect.element(handle()).toHaveAttribute('aria-valuenow', '40')
  })
})

describe('zoom and stepping', () => {
  it('fits by default, then shows the real size and steps', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    // One compact control: out, the zoom (Fit by default), in.
    const zoomGroup = page.getByRole('group', { name: 'Zoom' })
    await expect.element(zoomGroup).toBeVisible()
    expect(
      zoomGroup
        .getByRole('button')
        .elements()
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Zoom out', 'Fit', 'Zoom in'])
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await expect
      .element(page.getByRole('img', { name: /^This build: / }))
      .toHaveStyle({ width: '400px' })
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.element(page.getByRole('button', { name: '150%' })).toBeVisible()
    await expect
      .element(page.getByRole('img', { name: /^This build: / }))
      .toHaveStyle({ width: '600px' })
    await page.getByRole('button', { name: '150%' }).click()
    expect(page.getByText('150%').elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: 'Fit', exact: true })).toBeVisible()
  })

  it('steps with the previous and next buttons, disabled at the ends', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(page.getByRole('button', { name: 'Previous screenshot' })).toBeDisabled()
    await page.getByRole('button', { name: 'Next screenshot' }).click()
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    await expect.element(page.getByRole('button', { name: 'Previous screenshot' })).toBeEnabled()
  })
})
