import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { AppFrame } from '@circi/ui'

import { BuildPage } from '#features/builds/BuildPage.tsx'
import { validateBuildSearch } from '#features/builds/search.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { renderPage } from '#test/support/render.tsx'
import { openDialogs, toastNamed } from '#test/support/toast.ts'

import { detail, fakeBuildApi } from './fake-build-api.tsx'

/** The page in the app frame, as the shell shows it: the panel fills the window and the bar sits on its bottom edge. */
async function renderBuild() {
  await renderPage(
    <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
      <BuildPage />
    </AppFrame>,
    {
      route: '$workspace/$project/builds/$number',
      url: '/acme/web-app/builds/7',
      announcer: true,
      validateSearch: validateBuildSearch,
    },
  )
}

// The build page on a phone (canvas: Phone, the build page): 390 x 844.
beforeEach(async () => {
  await page.viewport(390, 844)
})

const viewerTitle = (name = 'checkout / payment') => page.getByRole('heading', { level: 2, name })
const bar = () => page.getByRole('group', { name: 'Review' })
const trigger = () => page.getByRole('button', { name: /^Enlarge This build/ })

async function ready() {
  const api = fakeBuildApi(detail())
  await renderBuild()
  await expect.element(viewerTitle()).toBeVisible()
  return api
}

/** Picks a view and measures its one image's figure against the row it sits in. */
async function widths(view: string, name: RegExp) {
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: view }).click()
  await expect.element(page.getByRole('img', { name })).toBeVisible()
  const figure = page.getByRole('img', { name }).element().closest('figure')!
  return {
    figure: figure.getBoundingClientRect().width,
    row: figure.parentElement!.getBoundingClientRect().width,
  }
}

describe('the build page on a phone', () => {
  it('has a bottom review bar: list, comments, Reject and Approve as the one primary', async () => {
    await ready()
    await expect.element(bar()).toBeVisible()
    const labels = bar()
      .getByRole('button')
      .elements()
      .map((el) => el.getAttribute('aria-label') ?? el.textContent)
    expect(labels).toEqual(['Screenshots, 1 / 5', 'Comments, 0', 'Reject', 'Approve'])
    for (const button of bar().getByRole('button').elements()) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    // Approve is the only primary in the bar; Approve all is not here.
    expect(
      bar()
        .getByRole('button', { name: /Approve all/ })
        .elements(),
    ).toHaveLength(0)
    await expect
      .element(bar().getByRole('button', { name: 'Approve' }))
      .toHaveAttribute('data-variant', 'primary')
    expect(bar().element().querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
    // A phone has no keyboard to speak of: no "?" button for the shortcuts.
    expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toHaveLength(0)
    // It sits on the bottom edge, and nothing scrolls sideways.
    expect(Math.round(bar().element().getBoundingClientRect().bottom)).toBe(844)
    expectNoSidewaysScroll()
  })

  it("shows the build's state in the header, on a line of its own under the branch", async () => {
    fakeBuildApi(detail({}, { watchers: [{ id: 'u2', name: 'Grace Hopper', image: null }] }))
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const header = document.querySelector('[data-panel-header]')!
    const state = header.querySelector('[data-header-status]')!
    expect(state.textContent).toContain('Needs review')
    expect(state.textContent).toContain('1')
    const branch = page.getByRole('button', { name: 'Copy branch name' }).element()
    expect(state.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      branch.getBoundingClientRect().bottom - 1,
    )
    expect(state.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    expectNoSidewaysScroll()
  })

  it("keeps the strip's information in the Details sheet, with the state, target and watchers above Build and People", async () => {
    const api = fakeBuildApi(
      detail({}, { watchers: [{ id: 'u2', name: 'Grace Hopper', image: null }] }),
    )
    api.activity = [
      {
        type: 'review_requested',
        at: new Date().toISOString(),
        reviewer: { id: 'u2', name: 'Grace Hopper', image: null },
        by: { id: 'u1', name: 'Ada Lovelace', image: null },
      },
    ]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    // Nothing between the header and the viewer.
    expect(document.querySelector('[class*="context"]')).toBeNull()
    await bar()
      .getByRole('button', { name: /^Comments/ })
      .click()
    const sheet = page.getByRole('dialog', { name: 'Comments' })
    await sheet.getByRole('tab', { name: 'Details' }).click()
    const text = () => sheet.element().textContent ?? ''
    await expect.element(sheet.getByText('Review target', { exact: true })).toBeVisible()
    const order = [
      'Status',
      'Review target',
      'Watchers',
      'Build',
      'Pull request',
      'Commit',
      'People',
    ]
    const at = order.map((t) => text().indexOf(t))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual(at.toSorted((x, y) => x - y))
    await expect.element(sheet.getByText(/Asked by Ada Lovelace/)).toBeVisible()
    await expect.element(sheet.getByText('build #6 on main', { exact: false })).toBeVisible()
  })

  it('puts the checkerboard in the same View options menu as a desktop, as a checkbox', async () => {
    await ready()
    await page.getByRole('button', { name: 'View options' }).click()
    await expect
      .element(page.getByRole('menuitemcheckbox', { name: 'Checkerboard' }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('captions the single image "This build" without its commit or size', async () => {
    await ready()
    await expect.element(page.getByText('This build', { exact: true })).toBeVisible()
    expect(page.getByText('400 × 300').elements()).toHaveLength(0)
  })

  it('approves at once with an Undo toast and moves to the next screenshot to review', async () => {
    const api = await ready()
    await bar().getByRole('button', { name: 'Approve' }).click()
    await expect.element(toastNamed('Approved checkout / payment')).toBeVisible()
    await expect
      .element(toastNamed('Approved checkout / payment').getByRole('button', { name: 'Undo' }))
      .toBeVisible()
    expect(api.reviews).toHaveLength(1)
    await expect.element(viewerTitle('checkout / address')).toBeVisible()
  })

  it('asks for the reason in the same dialog as on a desktop when rejecting', async () => {
    await ready()
    await bar().getByRole('button', { name: 'Reject' }).click()
    await expect
      .element(page.getByRole('dialog', { name: 'Reject checkout / payment?' }))
      .toBeVisible()
  })

  it('shows the screenshot list as a sheet; choosing a row shows it and closes the sheet', async () => {
    await ready()
    // Not beside the viewer.
    expect(page.getByRole('navigation', { name: 'Screenshots' }).elements()).toHaveLength(0)
    await bar().getByRole('button', { name: 'Screenshots, 1 / 5' }).click()
    const sheet = page.getByRole('dialog', { name: 'Screenshots' })
    await expect.element(sheet).toBeVisible()
    // The list's open groups: two changed and one added (the unchanged ones start closed).
    const rows = sheet.getByRole('link').elements()
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await sheet.getByRole('link', { name: /checkout \/ address/ }).click()
    await expect.poll(() => openDialogs().length).toBe(0)
    await expect.element(viewerTitle('checkout / address')).toBeVisible()
    await expect.element(bar().getByRole('button', { name: 'Screenshots, 2 / 5' })).toBeVisible()
  })

  it('shows the comments in a sheet, with the discussion tabs and the field', async () => {
    await ready()
    expect(page.getByRole('complementary', { name: 'Build discussion' }).elements()).toHaveLength(0)
    await bar().getByRole('button', { name: 'Comments, 0' }).click()
    const sheet = page.getByRole('dialog', { name: 'Comments' })
    await expect.element(sheet).toBeVisible()
    await expect
      .element(sheet.getByRole('tab', { name: 'Comments' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(sheet.getByRole('tabpanel')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => openDialogs().length).toBe(0)
  })

  it('puts Approve all, Request review and Copy link in the More sheet, not in the bar', async () => {
    await ready()
    await page.getByRole('button', { name: 'More actions' }).click()
    const sheet = page.getByRole('dialog', { name: 'More actions' })
    await expect.element(sheet.getByRole('button', { name: 'Approve all' })).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: 'Request review' })).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible()
    for (const button of sheet.getByRole('button').elements()) {
      if (button.getAttribute('aria-label') === 'Close') continue
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })

  it('moves the slider divider by touch on the handle, and not by touch elsewhere', async () => {
    await ready()
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Slider' }).click()
    const slider = page.getByRole('slider', { name: 'Slider position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    const head = page.getByRole('img', { name: /^This build/ })
    await expect.element(head).toBeVisible()
    const box = head.element().getBoundingClientRect()
    const y = box.top + box.height * 0.3
    const touch = (target: Element | null, from: number, to: number) => {
      const fire = (type: string, x: number) =>
        (type === 'pointerdown' ? target : document)?.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
          }),
        )
      fire('pointerdown', from)
      fire('pointermove', to)
      fire('pointerup', to)
    }
    // Away from the handle: the divider stays.
    const away = box.left + box.width * 0.2
    touch(document.elementFromPoint(away, y), away, box.left + box.width * 0.7)
    expect(slider.element().getAttribute('aria-valuenow')).toBe('50')
    // On the handle's line: it follows the finger.
    const line = box.left + box.width * 0.5
    const onHandle = document.elementFromPoint(line, y)
    expect(slider.element().parentElement?.contains(onHandle)).toBe(true)
    touch(onHandle, line, box.left + box.width * 0.8)
    await expect.poll(() => slider.element().getAttribute('aria-valuenow')).not.toBe('50')
    expect(Number(slider.element().getAttribute('aria-valuenow'))).toBeGreaterThan(70)
  })

  it('offers the four views, with Side by side in the options menu', async () => {
    await ready()
    const views = page.getByRole('group', { name: 'View' })
    const names = views
      .getByRole('button')
      .elements()
      .map((el) => el.textContent)
    expect(names).toEqual(['New', 'Baseline', 'Diff', 'Slider'])
    // At 390px every view fits inside the control (none clipped, none under another control), as 44px targets.
    const group = views.element().getBoundingClientRect()
    for (const button of views.getByRole('button').elements()) {
      const box = button.getBoundingClientRect()
      expect(box.right).toBeLessThanOrEqual(group.right + 1)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    expect(group.right).toBeLessThanOrEqual(window.innerWidth)
    const copy = page.getByRole('button', { name: 'Copy branch name' })
    expect(copy.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    // New shows one image.
    expect(page.getByRole('img', { name: /^Baseline/ }).elements()).toHaveLength(0)
    await views.getByRole('button', { name: 'Baseline' }).click()
    await expect.element(page.getByRole('img', { name: /^Baseline/ })).toBeVisible()
    expect(page.getByRole('img', { name: /^This build/ }).elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'View options' }).click()
    expect(page.getByRole('menuitem', { name: 'Overlay' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('menuitem', { name: 'Side by side' })).toBeVisible()
  })

  it('gives New and Baseline the whole width on a wide phone, not half of it', async () => {
    await page.viewport(700, 900)
    await ready()
    const shown = [await widths('New', /^This build/), await widths('Baseline', /^Baseline/)]
    for (const { figure, row } of shown) expect(figure).toBeGreaterThan(row - 2)
  })

  it('draws a comment region only in draw mode', async () => {
    await ready()
    const image = page.getByRole('img', { name: /^This build/ }).element()
    image.style.width = '400px'
    image.style.height = '300px'
    const draw = page.getByRole('button', { name: 'Draw a region' })
    const drawButton = draw.element()
    await expect.element(draw).toHaveAttribute('aria-pressed', 'false')
    // Off: a finger on the image draws nothing.
    await userEvent.dragAndDrop(trigger(), trigger(), {
      sourcePosition: { x: 40, y: 30 },
      targetPosition: { x: 200, y: 150 },
    })
    expect(page.getByRole('dialog', { name: 'Comment on this region' }).elements()).toHaveLength(0)
    // A press that does not draw enlarges the image: close that again.
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => openDialogs().length).toBe(0)
    await draw.click()
    await expect.element(draw).toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(page.getByRole('status').getByText(/Drag on the image to select a region/))
      .toBeVisible()
    expect(draw.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await userEvent.dragAndDrop(trigger(), trigger(), {
      sourcePosition: { x: 40, y: 30 },
      targetPosition: { x: 200, y: 150 },
    })
    // Drawing leaves draw mode and keeps the region, with its comment box.
    await expect.element(page.getByRole('dialog', { name: 'Comment on this region' })).toBeVisible()
    // (The page behind the box is out of the accessibility tree while it traps focus.)
    expect(drawButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('lets draw mode be left with Done', async () => {
    await ready()
    await page.getByRole('button', { name: 'Draw a region' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Draw a region' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('shows ignore regions, view only, from the options menu', async () => {
    const api = fakeBuildApi(detail())
    api.canManage = true
    api.ignoreRegions = [
      {
        id: 'r1',
        name: 'checkout / payment',
        x: 10,
        y: 10,
        width: 100,
        height: 40,
        createdAt: '2026-11-01T00:00:00.000Z',
        createdBy: { id: 'u1', name: 'Ada Lovelace' },
      },
    ]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Show ignore regions' }).click()
    await expect
      .element(page.getByText('Ignore regions show here but are edited on a larger screen.'))
      .toBeVisible()
    // No way to switch dragging to ignore regions here.
    expect(page.getByRole('group', { name: 'Dragging draws' }).elements()).toHaveLength(0)
  })
})

describe('the build page on a desktop', () => {
  it('keeps the list and the discussion beside the viewer, and has no phone bar', async () => {
    await page.viewport(1280, 900)
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Screenshots' })).toBeVisible()
    await expect
      .element(page.getByRole('complementary', { name: 'Build discussion' }))
      .toBeVisible()
    expect(page.getByRole('group', { name: 'Review' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Draw a region' }).elements()).toHaveLength(0)
  })
})

/** The vertical middle of an element. */
const mid = (el: Element) => {
  const box = el.getBoundingClientRect()
  return box.top + box.height / 2
}

describe('the build page header on a desktop', () => {
  it('keeps the buttons on the title line; the status chips always take a line of their own on the left, at any width', async () => {
    fakeBuildApi(detail())
    await page.viewport(1700, 900)
    await renderBuild()
    const title = page.getByRole('heading', { level: 1 })
    const approve = page.getByRole('button', { name: 'Approve this screenshot' })
    await expect.element(approve).toBeVisible()
    const chip = page.getByText('Needs review', { exact: true }).first()
    // Room enough still gives the chips their own line (the header is one height on every build).
    expect(chip.element().getBoundingClientRect().top).toBeGreaterThan(
      approve.element().getBoundingClientRect().bottom - 1,
    )
    expect(Math.abs(mid(approve.element()) - mid(title.element()))).toBeLessThan(4)
    // Short of room: the buttons keep the title's line (the crumbs give way, down to the "…", and
    // then the title is cut with an ellipsis); the chips take a line of their own under it,
    // starting on the left.
    await page.viewport(900, 900)
    await expect
      .poll(() => chip.element().getBoundingClientRect().top)
      .toBeGreaterThan(approve.element().getBoundingClientRect().bottom - 1)
    expect(Math.abs(mid(approve.element()) - mid(title.element()))).toBeLessThan(4)
    const header = approve.element().closest('header')!.getBoundingClientRect()
    expect(chip.element().getBoundingClientRect().left - header.left).toBeLessThan(40)
    // Nothing spills past the header.
    expect(approve.element().getBoundingClientRect().right).toBeLessThanOrEqual(header.right)
  })
})
