import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { decision, detail, fakeBuildApi, image, renderBuild, shot } from './fake-build-api.tsx'
import { toggleCheckerboard, viewOptions } from './view-options.ts'

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

/** One build in a screenshot's history on main. */
const entry = (number: number, status: 'changed' | 'unchanged', approver?: string) => ({
  build: {
    number,
    branch: 'main',
    status: 'complete' as const,
    reviewStatus: 'approved' as const,
    createdAt: new Date().toISOString(),
  },
  status,
  approvedBy: approver ? { id: 'u9', name: approver } : null,
  image: null,
})

/** A `review_requested` event: `by` is null when no one asked (assigned automatically). */
const asked = (id: string, name: string, byId: string | null, byName: string | null) => ({
  type: 'review_requested' as const,
  at: new Date().toISOString(),
  reviewer: { id, name, image: null },
  by: byId && byName ? { id: byId, name: byName, image: null } : null,
})

describe('the Details tab', () => {
  it('keeps the watchers in the header: the count, and on hover each of them with their picture', async () => {
    fakeBuildApi(
      detail(
        {},
        {
          watchers: [
            { id: 'u1', name: 'Ada Lovelace', image: null },
            { id: 'u2', name: 'Grace Hopper', image: null },
            { id: 'u3', name: 'Alan Turing', image: null },
          ],
        },
      ),
    )
    await renderBuild()
    await expect.element(facts().getByText('Decisions')).toBeVisible()
    // Not in Details on a desktop: the header has them.
    expect(facts().getByText('Watchers', { exact: true }).elements()).toHaveLength(0)
    const watchers = page.getByLabelText('3 watching, you included')
    await expect.element(watchers).toBeVisible()
    await watchers.hover()
    const tip = page.getByRole('tooltip')
    await expect.element(tip.getByText('Grace Hopper')).toBeVisible()
    const people = [...tip.element().querySelectorAll('li')]
    expect(people.map((li) => li.textContent)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Alan Turing',
    ])
    // A picture beside each name (here the generated one: nobody has uploaded theirs).
    for (const li of people) expect(li.querySelector('[data-avatar], img')).not.toBeNull()
  })

  it('has no state, target or reviewers in the header any more, only the watchers chip', async () => {
    const api = fakeBuildApi(
      detail({}, { watchers: [{ id: 'u1', name: 'Ada Lovelace', image: null }] }),
    )
    api.activity = [asked('u2', 'Grace Hopper', 'u1', 'Ada Lovelace')]
    await renderBuild()
    await expect.element(page.getByLabelText('1 watching, you included')).toBeVisible()
    expect(page.getByText(/Requested from/).elements()).toHaveLength(0)
    // The request is in the Details tab instead.
    await expect.element(facts().getByText('Grace Hopper')).toBeVisible()
  })

  it('lists the build in the Details tab: pull request, commit, branch, upload and baseline', async () => {
    fakeBuildApi(detail({}, { pullRequest: { number: 412, repo: 'acme/web-app' } }))
    await renderBuild()
    const build = facts().getByRole('region', { name: 'Build', exact: true })
    await expect.element(build).toBeVisible()
    const text = () => build.element().textContent ?? ''
    expect(text()).toContain('Pull requestacme/web-app#412')
    expect(text()).toContain('Commit0123456')
    expect(text()).toContain('Branchfeature/checkout')
    expect(text()).toContain('Uploaded')
    expect(text()).toContain('Baselinebuild #6 on mainwhere this branch started')
    await expect.element(build.getByText('0123456')).toHaveAttribute('title', '0123456789abcdef')
  })

  it('says the baseline is the latest on main when the git history was not available', async () => {
    fakeBuildApi(detail({ baselineSource: 'fallback', ancestryStatus: 'missing' }))
    await renderBuild()
    const build = facts().getByRole('region', { name: 'Build', exact: true })
    await expect
      .element(build.getByText("the latest on main: this build's git history wasn't available"))
      .toBeVisible()
    expect(build.element().textContent).not.toContain('where this branch started')
  })

  it('says "Nothing yet" for the baseline of a first build', async () => {
    fakeBuildApi(detail({ baselineSource: 'none' }, { baseline: null }))
    await renderBuild()
    const build = facts().getByRole('region', { name: 'Build', exact: true })
    await expect.element(build.getByText('Nothing yet')).toBeVisible()
  })

  it('lists the build, then the people, then the screenshot history', async () => {
    const api = fakeBuildApi(detail())
    api.history = [entry(6, 'changed', 'Maya Levi')]
    await renderBuild()
    await expect.element(facts().getByText(/approved by Maya Levi/)).toBeVisible()
    const text = facts().element().textContent ?? ''
    const order = ['Build', 'People', 'This screenshot on main', 'Decisions'].map((t) =>
      text.indexOf(t),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual(order.toSorted((x, y) => x - y))
  })

  it('shows the latest 3 changes of the screenshot on main, the rest behind Show all', async () => {
    const api = fakeBuildApi(detail())
    api.history = [
      entry(9, 'changed', 'Maya Levi'),
      entry(8, 'changed'),
      entry(7, 'changed'),
      entry(6, 'changed'),
      entry(5, 'changed'),
    ]
    await renderBuild()
    const history = page.getByRole('region', { name: /^History of / })
    await expect.element(history.getByText('Build #9')).toBeVisible()
    expect(history.getByRole('listitem').elements()).toHaveLength(3)
    await history.getByRole('button', { name: 'Show all 5' }).click()
    expect(history.getByRole('listitem').elements()).toHaveLength(5)
    await history.getByRole('button', { name: 'Show fewer' }).click()
    expect(history.getByRole('listitem').elements()).toHaveLength(3)
  })

  it('names each open reviewer with who asked them and when', async () => {
    const api = fakeBuildApi(detail())
    api.activity = [
      asked('u2', 'Grace Hopper', 'u1', 'Ada Lovelace'),
      asked('u3', 'Alan Turing', null, null),
      // Closed since: not listed.
      asked('u4', 'Edsger Dijkstra', 'u1', 'Ada Lovelace'),
      {
        type: 'review_request_closed',
        at: new Date().toISOString(),
        reviewer: { id: 'u4', name: 'Edsger Dijkstra', image: null },
        state: 'done',
      },
    ]
    await renderBuild()
    const people = facts().getByRole('region', { name: 'People' })
    await expect.element(people.getByText('Grace Hopper')).toBeVisible()
    await expect.element(people.getByText(/Asked by Ada Lovelace/)).toBeVisible()
    await expect.element(people.getByText('Alan Turing')).toBeVisible()
    await expect.element(people.getByText(/Assigned automatically/)).toBeVisible()
    expect(people.getByText('Edsger Dijkstra').elements()).toHaveLength(0)
    // A picture beside each name.
    expect(people.element().querySelectorAll('li [data-avatar], li img')).toHaveLength(2)
  })

  it('says no one has been asked yet', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect
      .element(facts().getByRole('region', { name: 'People' }).getByText('No one asked yet'))
      .toBeVisible()
  })

  it('leaves out "you\'re watching" in the header for someone who isn\'t notified', async () => {
    fakeBuildApi(detail({}, { watchers: [{ id: 'u2', name: 'Grace Hopper', image: null }] }))
    await renderBuild()
    await expect.element(page.getByLabelText('1 watching')).toBeVisible()
    expect(page.getByText("you're watching").elements()).toHaveLength(0)
  })

  it("lists the screenshot's changes on main, newest first, each linking to its build", async () => {
    const api = fakeBuildApi(detail())
    api.history = [entry(6, 'changed', 'Maya Levi'), entry(5, 'unchanged'), entry(3, 'changed')]
    await renderBuild()
    const history = facts()
    await expect.element(history.getByText(/approved by Maya Levi/)).toBeVisible()
    const links = history.getByRole('link', { name: /^Build #/ }).elements()
    expect(links.map((a) => a.textContent)).toEqual(['Build #6', 'Build #3'])
    expect(links[0]?.getAttribute('href')).toMatch(/builds\/6\?shot=/)
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

describe('the strip under the header', () => {
  it('is gone: nothing sits between the header and the list, and the chips are gone', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(document.querySelector('[class*="context"]')).toBeNull()
    for (const text of [/^PR #/, /^2 changed$/, /^1 added$/, /^Compared with/]) {
      expect(page.getByText(text).elements()).toHaveLength(0)
    }
  })

  it('still shows the fallback warning and the first-build note when they apply', async () => {
    fakeBuildApi(detail({ baselineSource: 'fallback' }))
    await renderBuild()
    await expect.element(page.getByText(/latest on the default branch/)).toBeVisible()
    expect(document.querySelector('[class*="context"]')).not.toBeNull()
  })

  it('shows the first-build note when there is no baseline', async () => {
    fakeBuildApi(detail({ baselineSource: 'none' }, { baseline: null }))
    await renderBuild()
    await expect.element(page.getByText(/This is the first build/)).toBeVisible()
  })

  it('puts "N of M reviewed" at the top of the screenshot list', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await expect.element(list.getByText('0 of 3 reviewed')).toBeVisible()
    const first = list.element().firstElementChild
    expect(first?.textContent).toBe('0 of 3 reviewed')
  })

  it('has no "reviewed" line when nothing needs a decision', async () => {
    fakeBuildApi(detail({}, { diffs: [shot('pricing', 'unchanged'), shot('about', 'unchanged')] }))
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByText(/ reviewed$/).elements()).toHaveLength(0)
  })
})

describe('the viewer', () => {
  it('captions the images "Baseline" and "This build", with no build, branch or commit', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(page.getByRole('img', { name: /^Baseline: / })).toBeVisible()
    await expect.element(page.getByRole('img', { name: /^This build: / })).toBeVisible()
    const captions = [...document.querySelectorAll('figure small')].map((c) => c.textContent)
    expect(captions).toEqual(['Baseline', 'This build'])
  })

  it('shows the size only when the baseline and the build differ', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByText('400 × 300').elements()).toHaveLength(0)
  })

  it("shows each image's size when the sizes differ", async () => {
    const [first, ...others] = detail().diffs
    if (!first?.base || !first.head) throw new Error('the fixture changed')
    const resized = {
      ...first,
      sizeChanged: true,
      head: { ...first.head, ...image('head-wide', 500, 300) },
    }
    fakeBuildApi(detail({}, { diffs: [resized, ...others] }))
    await renderBuild()
    await expect.element(page.getByText('400 × 300', { exact: true })).toBeVisible()
    await expect.element(page.getByText('500 × 300', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Size changed from 400×300 to 500×300')).toBeVisible()
  })

  it('captions the slider with "Baseline" alone', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    await expect
      .element(page.getByText('Baseline on the left, this build on the right'))
      .toBeVisible()
  })

  it('has the checkerboard off until it is switched on in View options', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByRole('button', { name: 'Checkerboard' }).elements()).toHaveLength(0)
    const background = () => getComputedStyle(ground() ?? document.body).backgroundImage
    expect(ground()?.hasAttribute('data-checkerboard')).toBe(false)
    expect(background()).toBe('none')
    await viewOptions().click()
    await expect
      .element(page.getByRole('menuitemcheckbox', { name: 'Checkerboard' }))
      .toHaveAttribute('aria-checked', 'false')
    await page.getByRole('menuitemcheckbox', { name: 'Checkerboard' }).click()
    expect(background()).toContain('conic-gradient')
    await toggleCheckerboard()
    await expect.poll(() => background()).toBe('none')
  })

  it('has a View options menu with Checkerboard, and for managers Comments and Ignore regions', async () => {
    const api = fakeBuildApi(detail())
    api.canManage = true
    await renderBuild()
    await viewOptions().click()
    const group = page.getByRole('group', { name: 'Dragging draws' })
    await expect.element(group.getByRole('menuitemradio', { name: 'Comments' })).toBeVisible()
    await expect.element(group.getByRole('menuitemradio', { name: 'Ignore regions' })).toBeVisible()
    await expect.element(page.getByRole('menuitemcheckbox', { name: 'Checkerboard' })).toBeVisible()
  })

  it('keeps the toolbar to one row when the viewer has room, with no hint text in it', async () => {
    await page.viewport(1700, 900)
    const api = fakeBuildApi(detail())
    api.canManage = true
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByText(/^Drag on an image/).elements()).toHaveLength(0)
    const toolbar = viewerTitle().element().closest('[class*="toolbar"]')
    expect(toolbar?.getBoundingClientRect().height).toBeLessThanOrEqual(48)
  })

  it('keeps the screenshot name readable when the viewer is narrow: the controls take a row of their own', async () => {
    await page.viewport(1100, 900)
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const name = viewerTitle().element()
    expect(name.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      Math.min(96, name.scrollWidth),
    )
  })

  it('lists dragging on an image in the keyboard shortcuts', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect.element(dialog.getByText('Drag on an image: comment on a region')).toBeVisible()
  })

  it('tells the enlarged view that a drag comments on a region', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: /^Enlarge This build/ }).click()
    const dialog = page.getByRole('dialog', { name: 'This build' })
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
