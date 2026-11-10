import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinesPage } from '#features/baselines/BaselinesPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/teams/acme/web/baselines'
const FLAKY = '/api/teams/acme/web/flaky'
const noFlaky = json({ builds: 10, flaky: [] })
const open = () =>
  renderPage(<BaselinesPage />, {
    route: '/$workspace/$team/baselines/',
    url: '/acme/web/baselines',
    announcer: true,
  })

const item = (name: string, buildName: string, buildNumber: number) => ({
  name,
  buildName,
  width: 400,
  height: 300,
  sizeBytes: 20_480,
  fileSha256: `${name}-f`,
  thumbnailSha256: `${name}-t`,
  buildNumber,
  commitSha: 'abcdef1',
  approvedAt: '2026-11-08T10:00:00.000Z',
  approvedBy: null,
})

const list = (baselines: unknown[]) => ({
  team: { slug: 'web', name: 'Web', defaultBranch: 'main' },
  baselines,
})

describe('BaselinesPage', () => {
  it('groups baselines by name prefix, links to the baseline page (and its build) and searches', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([
        item('checkout/payment', 'default', 12),
        item('checkout/summary', 'default', 11),
        item('home', 'default', 9),
      ]),
      [`GET ${FLAKY}`]: noFlaky,
    })
    await open()
    await expect.element(page.getByRole('heading', { name: /checkout/ })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /Ungrouped/ })).toBeVisible()
    await expect.element(page.getByText('3 on main')).toBeVisible()
    const link = page.getByRole('link', { name: /checkout\/payment/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/baselines/checkout/payment')
    await expect
      .element(page.getByRole('link', { name: /^Build #12/ }))
      .toHaveAttribute('href', '/acme/web/builds/12')

    const search = page.getByRole('textbox', { name: 'Find baselines' })
    await expect.element(search).toHaveAttribute('placeholder', 'Find baselines')
    await userEvent.fill(search, 'home')
    await expect.element(page.getByText('1 on main')).toBeVisible()
    await expect.element(page.getByRole('link', { name: /checkout/ })).not.toBeInTheDocument()

    await userEvent.fill(search, 'zzz')
    await expectEmptyState('No baseline matches “zzz”', { action: 'Clear search' })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(search).toHaveValue('')
    await expect.element(page.getByRole('link', { name: /checkout/ }).first()).toBeVisible()
  })

  it('keeps the find text in the address, focuses it with / and clears it with Esc', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([item('checkout/payment', 'default', 12), item('home', 'default', 9)]),
      [`GET ${FLAKY}`]: noFlaky,
    })
    const { router } = await open()
    const search = page.getByRole('textbox', { name: 'Find baselines' })
    await userEvent.keyboard('/')
    await expect.element(search).toHaveFocus()
    // The slash itself is not typed into the field.
    await expect.element(search).toHaveValue('')
    await userEvent.type(search, 'pay')
    await expect.element(page.getByRole('link', { name: /home/ })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'pay' }))
    await userEvent.keyboard('{Escape}')
    await expect.element(search).toHaveValue('')
    await expect.element(page.getByRole('link', { name: /home/ })).toBeVisible()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })

  it('starts from the find text in the address', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([item('checkout/payment', 'default', 12), item('home', 'default', 9)]),
      [`GET ${FLAKY}`]: noFlaky,
    })
    await renderPage(<BaselinesPage />, {
      route: '/$workspace/$team/baselines/',
      url: '/acme/web/baselines?q=home',
      announcer: true,
    })
    await expect.element(page.getByRole('textbox', { name: 'Find baselines' })).toHaveValue('home')
    await expect.element(page.getByRole('link', { name: /checkout/ })).not.toBeInTheDocument()
  })

  it('marks a flaky screenshot in the last column, and shows the age compactly', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([
        {
          ...item('checkout/payment', 'default', 12),
          approvedAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
        },
        {
          ...item('checkout/summary', 'default', 11),
          approvedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      ]),
      [`GET ${FLAKY}`]: json({ builds: 10, flaky: [{ name: 'checkout/payment', changedIn: 4 }] }),
    })
    await open()
    await expect.element(page.getByText('2d')).toBeVisible()
    await expect.element(page.getByText('1h')).toBeVisible()
    const marks = page.getByRole('img', { name: 'Flaky: changed in 4 of the last 10 builds' })
    await expect.element(marks).toBeVisible()
    expect(marks.elements()).toHaveLength(1)
  })

  it('says so when there are none, centred in the content area, with no find field', async () => {
    await page.viewport(1200, 800)
    fakeFetch({ [`GET ${PATH}`]: list([]), [`GET ${FLAKY}`]: noFlaky })
    await open()
    const title = page.getByRole('heading', { name: 'No baselines yet' })
    await expectEmptyState('No baselines yet', {
      body: 'Once a build of main finishes, its screenshots become the baselines.',
      centred: true,
    })
    const box = title.element().getBoundingClientRect()
    expect(Math.abs(box.left + box.width / 2 - 1200 / 2)).toBeLessThan(150)
    expect(box.top).toBeGreaterThan(150)
    expect(page.getByRole('textbox', { name: 'Find baselines' }).elements()).toHaveLength(0)
  })

  it('shows an error with a retry', async () => {
    fakeFetch({ [`GET ${PATH}`]: json({ error: 'boom' }, 500) })
    await open()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
