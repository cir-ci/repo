import { AppFrame } from '@circi/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { PageHeading, PageTitle, projectCrumb, workspaceCrumb } from '#lib/PageHeading.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { sidebarModel } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

describe('PageHeading', () => {
  it("makes the current crumb the page's h1, as plain text", async () => {
    await renderPage(<PageHeading title="Webhooks" />)
    const h1 = page.getByRole('heading', { level: 1 })
    await expect.element(h1).toHaveTextContent('Webhooks')
    await expect.element(h1).toHaveAttribute('aria-current', 'page')
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
    expect(page.getByRole('link').elements()).toHaveLength(0)
  })

  it('links a workspace crumb to the Inbox and a project crumb to its Builds page, with tooltips', async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web', name: 'web-app' }),
        ]}
        title="Webhooks"
      />,
    )
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(nav.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/inbox')
    await expect
      .element(nav.getByRole('link', { name: 'web-app' }))
      .toHaveAttribute('href', '/acme/web')
    await expect.element(nav.getByRole('heading', { level: 1 })).toHaveTextContent('Webhooks')
    // The sidebar toggle comes first in the bar.
    await userEvent.tab()
    await userEvent.tab()
    await expect.element(page.getByText('Workspace: opens the Inbox')).toBeVisible()
    await userEvent.tab()
    await expect.element(page.getByText('Project: opens its Builds page')).toBeVisible()
  })

  it("shows the page's actions on the right", async () => {
    await renderPage(
      <PageHeading title="Projects" actions={<button type="button">New project</button>} />,
    )
    await expect.element(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })
})

/** The vertical middle of an element: two on one line share it. */
const middle = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.top + r.height / 2
}

describe('PageHeading on a phone', () => {
  it("keeps the page's buttons on the title's line and moves what follows the title (a branch) below", async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web-app', name: 'Web app' }),
        ]}
        title="Build #34"
        after={<span>feat/a-rather-long-branch-name</span>}
        afterOwnRow
        actions={<button type="button">More</button>}
      />,
      { viewport: [390, 844] },
    )
    const title = page.getByRole('heading', { name: 'Build #34' })
    await expect.element(title).toBeVisible()
    const line = middle(title.element())
    // The page's own, and the phone's Search.
    for (const name of ['More', 'Search']) {
      expect(Math.abs(middle(page.getByRole('button', { name }).element()) - line)).toBeLessThan(4)
    }
    // With room left, the title isn't cut short (no spacer shares the line's room with it).
    expect(title.element().scrollWidth).toBeLessThanOrEqual(title.element().clientWidth)
    // The branch wrapped under them.
    expect(
      page.getByText('feat/a-rather-long-branch-name').element().getBoundingClientRect().top,
    ).toBeGreaterThan(title.element().getBoundingClientRect().bottom)
  })
})

function buildHeading() {
  return (
    <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web-app', name: 'Component gallery' }),
          {
            label: 'Builds',
            link: { to: '/$workspace/$project', params: { workspace: 'acme', project: 'web-app' } },
          },
        ]}
        title="Build #104"
        after={<span>feat/new-theme-for-the-component-gallery</span>}
        afterOwnRow
        status={
          <>
            <span>Needs review</span>
            <span>Overdue 3d</span>
            <span>4 watching</span>
          </>
        }
        actions={
          <>
            <button type="button">Approve all</button>
            <button type="button">Reject all</button>
          </>
        }
      />
    </AppFrame>
  )
}

describe('PageHeading with status chips on a narrow desktop', () => {
  it.each([1100, 1000, 900])(
    'keeps the title at its full width, with the buttons on its line, at %ipx',
    async (width) => {
      await renderPage(buildHeading(), { viewport: [width, 800] })
      const title = page.getByRole('heading', { name: 'Build #104' })
      await expect.element(title).toBeVisible()
      const el = title.element()
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth)
      expect(el.getBoundingClientRect().width).toBeGreaterThan(50)
      const line = middle(el)
      for (const name of ['Approve all', 'Reject all']) {
        const button = page.getByRole('button', { name }).element()
        expect(Math.abs(middle(button) - line)).toBeLessThan(4)
        expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(
          el.getBoundingClientRect().right,
        )
      }
    },
  )
})

describe('PageHeading with status chips on a phone', () => {
  it('draws no crumb over another', async () => {
    await renderPage(buildHeading(), { viewport: [390, 844] })
    await expect.element(page.getByRole('heading', { name: 'Build #104' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' }).element()
    const boxes = [...nav.querySelectorAll('li')].map((li) => li.getBoundingClientRect())
    for (const [i, box] of boxes.slice(0, -1).entries()) {
      expect(boxes[i + 1]!.left).toBeGreaterThanOrEqual(box.right - 1)
    }
    for (const link of nav.querySelectorAll('a')) {
      const li = link.closest('li')
      expect(link.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        (li?.getBoundingClientRect().left ?? 0) - 1,
      )
    }
  })
})

describe('PageHeading on a phone, with a count after the title', () => {
  it('keeps the count beside the title and the buttons on the same line', async () => {
    await renderPage(
      <PageHeading
        crumbs={[
          workspaceCrumb({ slug: 'acme', name: 'Acme' }),
          projectCrumb('acme', { slug: 'web-app', name: 'Web app' }),
        ]}
        title="Triage"
        after={<span>5</span>}
      />,
      { viewport: [390, 844] },
    )
    const title = page.getByRole('heading', { name: 'Triage' })
    await expect.element(title).toBeVisible()
    const count = page.getByText('5', { exact: true }).element()
    expect(Math.abs(middle(count) - middle(title.element()))).toBeLessThan(4)
    expect(
      Math.abs(
        middle(page.getByRole('button', { name: 'Search' }).element()) - middle(title.element()),
      ),
    ).toBeLessThan(4)
  })
})

describe('PageHeading on a phone, on a project page', () => {
  it("puts the find field and the project's page icons on one row, the icons on the right", async () => {
    fakeApi({ 'GET /api/workspaces/acme/sidebar': { body: sidebarModel({ projects: [] }) } })
    await renderPage(<PageHeading title="Builds" find={<input aria-label="Find builds" />} />, {
      route: '/$workspace/$project',
      url: '/acme/web-app',
      viewport: [390, 844],
    })
    const pages = page.getByRole('tablist', { name: 'Project pages' })
    await expect.element(pages).toBeVisible()
    const find = page.getByRole('textbox', { name: 'Find builds' }).element()
    expect(Math.abs(middle(find) - middle(pages.element()))).toBeLessThan(4)
    expect(pages.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
      find.getBoundingClientRect().right,
    )
  })
})

describe('PageHeading on a phone, in the app frame', () => {
  it('keeps the find field and the page icons fixed with the header; only the content scrolls', async () => {
    fakeApi({ 'GET /api/workspaces/acme/sidebar': { body: sidebarModel({ projects: [] }) } })
    await renderPage(
      <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
        <PageHeading title="Builds" find={<input aria-label="Find builds" />} />
        <div style={{ height: 3000, flexShrink: 0 }}>Long list</div>
      </AppFrame>,
      { route: '/$workspace/$project', url: '/acme/web-app', viewport: [390, 844] },
    )
    const pages = page.getByRole('tablist', { name: 'Project pages' })
    await expect.element(pages).toBeVisible()
    const find = page.getByRole('textbox', { name: 'Find builds' }).element()
    const main = page.getByRole('main').element()
    expect(main.contains(find)).toBe(false)
    expect(main.contains(pages.element())).toBe(false)
    // The scroller starts under the row.
    expect(main.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      pages.element().getBoundingClientRect().bottom - 1,
    )
    const before = find.getBoundingClientRect().top
    main.scrollTop = 400
    await expect.poll(() => main.scrollTop).toBeGreaterThan(0)
    expect(find.getBoundingClientRect().top).toBe(before)
  })
})

describe('PageHeading on a phone, in the app frame with classic scrollbars', () => {
  it('keeps the find row and the page icons where they are while the scroller scrolls, and the scroller starts below them', async () => {
    const style = document.createElement('style')
    style.textContent = '*::-webkit-scrollbar { width: 12px; height: 12px }'
    document.head.append(style)
    try {
      fakeApi({ 'GET /api/workspaces/acme/sidebar': { body: sidebarModel({ projects: [] }) } })
      await renderPage(
        <AppFrame sidebar={<span>Side</span>} compactBar={<span>Bar</span>}>
          <PageHeading title="Builds" find={<input aria-label="Find builds" />} />
          <div style={{ height: 3000, flexShrink: 0 }}>Long list</div>
        </AppFrame>,
        { route: '/$workspace/$project', url: '/acme/web-app', viewport: [390, 844] },
      )
      const pages = page.getByRole('tablist', { name: 'Project pages' })
      await expect.element(pages).toBeVisible()
      const find = page.getByRole('textbox', { name: 'Find builds' }).element()
      const main = page.getByRole('main').element()
      // A phone reserves no gutter (its bars are overlays), so a classic bar costs the row nothing.
      expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
      const row = () => ({
        find: find.getBoundingClientRect().top,
        pages: pages.element().getBoundingClientRect().top,
        main: main.getBoundingClientRect().top,
      })
      const before = row()
      expect(before.main).toBeGreaterThanOrEqual(pages.element().getBoundingClientRect().bottom - 1)
      expect(before.main).toBeGreaterThanOrEqual(find.getBoundingClientRect().bottom - 1)
      main.scrollTop = 600
      await expect.poll(() => main.scrollTop).toBe(600)
      expect(row()).toEqual(before)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
      expect(window.scrollY).toBe(0)
    } finally {
      style.remove()
    }
  })
})

describe('PageTitle', () => {
  it('is a hidden h1 that assistive technology still reads', async () => {
    await renderPage(<PageTitle>Sign in</PageTitle>)
    const h1 = page.getByRole('heading', { level: 1, name: 'Sign in' })
    await expect.element(h1).toBeInTheDocument()
    expect(h1.element().getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })
})
