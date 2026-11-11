import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { decision, detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

beforeEach(async () => {
  await page.viewport(1280, 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const HOUR = 3_600_000
/** A due time `h` hours from now, a minute early so the rounded-down figure is exact. */
const inHours = (h: number) => new Date(Date.now() + h * HOUR - 60_000).toISOString()

const ground = () => document.querySelector('[class*="ground"]')
const viewerTitle = () => page.getByRole('heading', { level: 2 })
const facts = () => page.getByRole('tabpanel')

describe('the build header', () => {
  it('counts the review target down beside the status chip', async () => {
    fakeBuildApi(detail({}, { reviewTarget: { hours: 24, dueAt: inHours(22) } }))
    await renderBuild()
    await expect.element(page.getByText('Review target: 21h left')).toBeVisible()
  })

  it('turns to "Overdue" in red once the target is past', async () => {
    fakeBuildApi(detail({}, { reviewTarget: { hours: 24, dueAt: inHours(-2) } }))
    await renderBuild()
    const late = page.getByText('Overdue 2h', { exact: true })
    await expect.element(late).toBeVisible()
    await expect.element(late).toHaveAttribute('data-tone', 'failed')
    expect(page.getByText(/Review target:/).elements()).toHaveLength(0)
  })

  it('says nothing while no request is counting down', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByText(/Review target:/).elements()).toHaveLength(0)
  })

  it('shows the key beside Approve all', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const button = page.getByRole('button', { name: /^Approve all/ })
    await expect.element(button.getByText('⇧A')).toBeVisible()
  })
})

describe('the Details tab', () => {
  it('lists the build facts: status, reviewers, review target, pull request and watchers', async () => {
    const api = fakeBuildApi(
      detail(
        {},
        {
          reviewTarget: { hours: 24, dueAt: inHours(22) },
          watchers: [
            { id: 'u1', name: 'Ada Lovelace' },
            { id: 'u2', name: 'Grace Hopper' },
            { id: 'u3', name: 'Alan Turing' },
          ],
          pullRequest: { number: 412, repo: 'acme/web-app' },
        },
      ),
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
    const dl = facts()
    await expect.element(dl.getByText('Status', { exact: true })).toBeVisible()
    await expect.element(dl.getByText('Needs review')).toBeVisible()
    await expect.element(dl.getByText('Grace Hopper', { exact: true })).toBeVisible()
    await expect.element(dl.getByText('21h left of 24h')).toBeVisible()
    await expect.element(dl.getByText('acme/web-app#412')).toBeVisible()
    await expect.element(dl.getByText("3 · you're watching")).toBeVisible()
    // The existing rows stay.
    await expect.element(dl.getByText('Branch', { exact: true })).toBeVisible()
    await expect.element(dl.getByText('Commit', { exact: true })).toBeVisible()
    await expect.element(dl.getByText('Compared with', { exact: true })).toBeVisible()
    await expect.element(dl.getByText('Uploaded', { exact: true })).toBeVisible()
  })

  it('says how late a review is, against the target', async () => {
    fakeBuildApi(detail({}, { reviewTarget: { hours: 24, dueAt: inHours(-3) } }))
    await renderBuild()
    await expect.element(facts().getByText('Overdue 3h, past the 24h target')).toBeVisible()
  })

  it('leaves out "you\'re watching" for someone who isn\'t notified, and the pull request when there is none', async () => {
    fakeBuildApi(detail({}, { watchers: [{ id: 'u2', name: 'Grace Hopper' }], pullRequest: null }))
    await renderBuild()
    await expect.element(facts().getByText('1', { exact: true })).toBeVisible()
    expect(page.getByText("you're watching").elements()).toHaveLength(0)
    expect(facts().getByText('Pull request').elements()).toHaveLength(0)
  })

  it('titles the decisions list "By screenshot"', async () => {
    const api = fakeBuildApi(detail())
    const [first] = api.build.diffs
    if (first) first.review = decision('approved')
    await renderBuild()
    await expect.element(facts().getByText('By screenshot')).toBeVisible()
    expect(page.getByText('By snapshot').elements()).toHaveLength(0)
  })
})

describe('the viewer', () => {
  it('labels the images with where they come from and their size', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(page.getByText('Baseline · #6 on main')).toBeVisible()
    await expect.element(page.getByText('This build · 0123456')).toBeVisible()
    expect(page.getByText('400 × 300').elements()).toHaveLength(2)
  })

  it('has the checkerboard off until it is switched on', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const toggle = page.getByRole('button', { name: 'Checkerboard' })
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
    const background = () => getComputedStyle(ground() ?? document.body).backgroundImage
    expect(ground()?.hasAttribute('data-checkerboard')).toBe(false)
    expect(background()).toBe('none')
    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(background()).toContain('conic-gradient')
    await toggle.click()
    await expect.poll(() => background()).toBe('none')
  })

  it('names the control for what a drag draws', async () => {
    const api = fakeBuildApi(detail())
    api.canManage = true
    await renderBuild()
    const group = page.getByRole('group', { name: 'Dragging draws' })
    await expect.element(group.getByRole('button', { name: 'Comments' })).toBeVisible()
    await expect.element(group.getByRole('button', { name: 'Ignore regions' })).toBeVisible()
  })

  it('tells the enlarged view that a drag comments on a region', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: /^Enlarge This build/ }).click()
    const dialog = page.getByRole('dialog', { name: 'This build · 0123456' })
    await expect.element(dialog.getByText(/drag to comment on a region/)).toBeVisible()
    await expect.element(dialog.getByText('400 × 300', { exact: true })).toBeVisible()
  })
})

describe('the screenshot list', () => {
  it('shows a comment count on the rows that have threads, and only those', async () => {
    const api = fakeBuildApi(detail())
    const base = {
      parentId: null,
      region: null,
      regionSide: 'current' as const,
      body: 'Looks off',
      author: { id: 'u2', name: 'Grace Hopper', image: null },
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      mine: false,
      canDelete: false,
    }
    api.comments = [
      { ...base, id: 'c1', snapshotName: 'checkout / payment' },
      { ...base, id: 'c2', snapshotName: 'checkout / payment' },
      { ...base, id: 'c3', parentId: 'c1', snapshotName: 'checkout / payment' },
      { ...base, id: 'c4', snapshotName: null },
    ]
    await renderBuild()
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await expect.element(list.getByRole('img', { name: '2 comment threads' })).toBeVisible()
    expect(list.getByRole('img', { name: /comment thread/ }).elements()).toHaveLength(1)
  })
})
