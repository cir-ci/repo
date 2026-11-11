import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { BaselinesPage } from '#features/baselines/BaselinesPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { menuItemNames } from '#test/support/menu.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/projects/acme/web/baselines'
const FLAKY = '/api/projects/acme/web/flaky'
const noFlaky = json({ builds: 10, flaky: [] })
const open = () =>
  renderPage(<BaselinesPage />, {
    route: '/$workspace/$project/baselines/',
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
  project: { slug: 'web', name: 'Web', defaultBranch: 'main' },
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
    const { router } = await open()
    await expect.element(page.getByRole('heading', { name: /checkout/ })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /Ungrouped/ })).toBeVisible()
    await expect.element(page.getByText('3 on main')).toBeVisible()
    const link = page.getByRole('link', { name: /checkout\/payment/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/baselines/checkout/payment')
    // The subtitle names the build; the hover chip opens it.
    await expect.element(page.getByText('Build #12')).toBeVisible()

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

    await link.hover()
    await page.getByText('Open build #12 ↗').click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/12'))
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
      route: '/$workspace/$project/baselines/',
      url: '/acme/web/baselines?q=home',
      announcer: true,
    })
    await expect.element(page.getByRole('textbox', { name: 'Find baselines' })).toHaveValue('home')
    await expect.element(page.getByRole('link', { name: /checkout/ })).not.toBeInTheDocument()
  })

  it('marks a flaky screenshot with a chip saying why, which opens it in Triage, and shows the age compactly', async () => {
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
      [`GET ${FLAKY}`]: json({
        builds: 10,
        flaky: [
          {
            name: 'checkout/payment',
            changedIn: 4,
            reason: {
              kind: 'reruns_disagree',
              reruns: { build: 12, runs: 2, differing: 1, commits: 1 },
            },
          },
        ],
      }),
    })
    const { router } = await open()
    await expect.element(page.getByText('2d')).toBeVisible()
    await expect.element(page.getByText('1h')).toBeVisible()
    // The flaky mark is a chip with the reason in words, on that row only.
    const chip = page.getByText('Differed across 2 runs of one commit', { exact: true })
    await expect.element(chip).toBeVisible()
    expect(chip.elements()).toHaveLength(1)
    await expect.element(page.getByText('Build #12', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Build #11', { exact: true })).toBeVisible()
    // It opens the screenshot's item in Triage, not the baseline the row leads to.
    await chip.click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/triage')
    expect(router.state.location.search).toEqual({ item: 'flaky:checkout/payment' })
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

describe('BaselinesPage on a phone', () => {
  const flakyReply = json({
    builds: 10,
    flaky: [
      {
        name: 'checkout/payment',
        changedIn: 4,
        reason: {
          kind: 'reruns_disagree',
          reruns: { build: 12, runs: 2, differing: 1, commits: 1 },
        },
      },
    ],
  })
  const longName = `checkout/${'a-very-long-screenshot-name-'.repeat(4)}end`

  it('makes the whole row the tap target: no arrow button, the flaky chip at the end before the age, no sideways scroll', async () => {
    await page.viewport(390, 844)
    fakeFetch({
      [`GET ${PATH}`]: list([
        item('checkout/payment', 'default', 12),
        item(longName, 'default', 11),
      ]),
      [`GET ${FLAKY}`]: flakyReply,
    })
    await open()
    const row = page.getByRole('link', { name: /checkout\/payment/ })
    await expect.element(row).toBeVisible()
    // The hover chip (an arrow on a phone) is gone: nothing else to tap but the row.
    expect(
      page
        .getByText('Open build #12 ↗')
        .elements()
        .filter((el) => el.getBoundingClientRect().width > 0),
    ).toHaveLength(0)
    const rowBox = row.element().getBoundingClientRect()
    expect(rowBox.height).toBeGreaterThanOrEqual(44)
    const chip = page
      .getByText('Differed across 2 runs of one commit')
      .element()
      .getBoundingClientRect()
    const age = page.getByText('2d').first().element().getBoundingClientRect()
    // Right after the name and the build, at the row's end, just before the age.
    expect(chip.right).toBeLessThanOrEqual(age.left + 1)
    expect(chip.right).toBeGreaterThan(rowBox.right - 80)
    expectNoSidewaysScroll()
  })

  it('keeps the hover chip on a desktop', async () => {
    await page.viewport(1280, 800)
    fakeFetch({ [`GET ${PATH}`]: list([item('home', 'default', 9)]), [`GET ${FLAKY}`]: noFlaky })
    await open()
    await page.getByRole('link', { name: /home/ }).hover()
    await expect.element(page.getByText('Open build #9 ↗')).toBeVisible()
  })
})

describe('right-click menu on a baseline row', () => {
  const flaky = json({
    builds: 10,
    flaky: [
      {
        name: 'checkout/payment',
        changedIn: 4,
        reason: {
          kind: 'reruns_disagree',
          reruns: { build: 12, runs: 2, differing: 1, commits: 1 },
        },
      },
    ],
  })

  it('offers Open in Triage only for a flaky baseline, which goes to its Triage item', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([item('checkout/payment', 'default', 12), item('home', 'default', 9)]),
      [`GET ${FLAKY}`]: flaky,
    })
    const { router } = await open()
    await page.getByRole('link', { name: /checkout\/payment/ }).click({ button: 'right' })
    expect(menuItemNames()).toEqual([
      'Open',
      'Open build #12',
      'Open in Triage',
      'Open in new tab',
      'Copy link',
      'Copy name',
    ])
    await page.getByRole('menuitem', { name: 'Open in Triage' }).click()
    await vi.waitFor(() =>
      expect(router.state.location.search).toEqual({ item: 'flaky:checkout/payment' }),
    )
  })

  it('leaves Open in Triage out for a stable baseline', async () => {
    fakeFetch({
      [`GET ${PATH}`]: list([item('home', 'default', 9)]),
      [`GET ${FLAKY}`]: noFlaky,
    })
    await open()
    await page.getByRole('link', { name: /home/ }).click({ button: 'right' })
    expect(menuItemNames()).toEqual([
      'Open',
      'Open build #9',
      'Open in new tab',
      'Copy link',
      'Copy name',
    ])
  })
})
