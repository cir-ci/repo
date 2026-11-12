import { AppFrame } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { BuildPage } from '#features/builds/BuildPage.tsx'
import { validateBuildSearch } from '#features/builds/search.ts'
import { renderPage } from '#test/support/render.tsx'

import { detail, fakeBuildApi, shot } from './fake-build-api.tsx'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

const box = (el: Element) => el.getBoundingClientRect()

describe('the build page at desktop, in the app frame', () => {
  it('keeps the list, the viewer and the Discussion under the header while the scroller scrolls', async () => {
    const diffs = Array.from({ length: 60 }, (_, i) => shot(`page ${i}`, 'changed'))
    fakeBuildApi(detail({}, { diffs }))
    await renderPage(
      <AppFrame sidebar={<span>Side</span>}>
        <BuildPage />
      </AppFrame>,
      {
        route: '$workspace/$project/builds/$number',
        url: '/acme/web-app/builds/7',
        announcer: true,
        validateSearch: validateBuildSearch,
        viewport: [1280, 600],
      },
    )
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await expect.element(list).toBeVisible()
    const body = list.element().parentElement!
    const [viewer, discussion] = [body.children[1]!, body.lastElementChild!]
    const main = page.getByRole('main').element()
    const header = document.querySelector('header')!
    // The header's height reaches the panel (its chips may take a line of their own) after a frame.
    await expect
      .poll(() =>
        main.closest<HTMLElement>('[data-panel]')?.style.getPropertyValue('--circi-panel-top'),
      )
      .toContain(`${box(main.previousElementSibling!).height}px`)
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
    const stuck = () => [list.element(), viewer, discussion].map((el) => box(el).top)
    // Under the header from the start, and the scroller itself starts under the header.
    expect(box(main).top).toBeGreaterThanOrEqual(box(header).bottom - 1)
    for (const top of stuck()) expect(top).toBeGreaterThanOrEqual(box(header).bottom - 1)
    main.scrollTo({ top: 300 })
    await expect.poll(() => main.scrollTop).toBeGreaterThan(0)
    expect(box(header).bottom).toBeLessThanOrEqual(box(main).top + 1)
    for (const el of [list.element(), viewer, discussion]) {
      // Stuck at the scroller's top: not hidden behind the header, not moved above the scroller.
      expect(box(el).top).toBeGreaterThanOrEqual(box(main).top - 1)
      expect(box(el).top).toBeLessThanOrEqual(box(main).top + 1)
    }
  })
})

describe('the build page under 1100px, in the app frame', () => {
  it('stacks the Discussion under the viewer, holding all of the viewer, and scrolls them as one', async () => {
    fakeBuildApi(detail())
    await renderPage(
      <AppFrame sidebar={<span>Side</span>}>
        <BuildPage />
      </AppFrame>,
      {
        route: '$workspace/$project/builds/$number',
        url: '/acme/web-app/builds/7',
        announcer: true,
        validateSearch: validateBuildSearch,
        viewport: [1000, 500],
      },
    )
    const discussion = page.getByRole('complementary', { name: 'Build discussion' })
    await expect.element(discussion).toBeVisible()
    const list = page.getByRole('navigation', { name: 'Screenshots' }).element()
    const viewer = list.parentElement!.children[1]!
    // The viewer's row holds all of the viewer: nothing of it draws over the Discussion below.
    await expect.poll(() => viewer.scrollHeight).toBeLessThanOrEqual(box(viewer).height + 1)
    expect(box(discussion.element()).top).toBeGreaterThanOrEqual(box(viewer).bottom - 1)
    // The Discussion is opaque and above the list's resize line.
    expect(getComputedStyle(discussion.element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    // The page is taller than the panel and the panel scrolls it.
    const main = page.getByRole('main').element()
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
  })
})
