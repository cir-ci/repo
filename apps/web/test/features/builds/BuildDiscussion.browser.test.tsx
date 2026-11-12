import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { expectEmptyState } from '#test/support/empty-state.ts'
import { toastNamed } from '#test/support/toast.ts'

import { decision, detail, fakeBuildApi, renderBuild, shot } from './fake-build-api.tsx'

beforeEach(async () => {
  await page.viewport(1400, 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const viewerTitle = () => page.getByRole('heading', { level: 2, name: 'checkout / payment' })

const ada = { id: 'm1', userId: 'u1', user: { name: 'Ada Lovelace', email: 'ada@example.test' } }
const grace = {
  id: 'm2',
  userId: 'u2',
  user: { name: 'Grace Hopper', email: 'grace@example.test' },
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

const comment = (id: string, over: object = {}) => ({
  id,
  parentId: null,
  snapshotName: null,
  region: null,
  regionSide: 'current' as const,
  body: `body ${id}`,
  author: { id: 'u2', name: 'Grace Hopper', image: null },
  createdAt: at(5),
  editedAt: null,
  deletedAt: null,
  mine: false,
  canDelete: false,
  ...over,
})

describe('sidebar tabs', () => {
  it('keeps the chosen tab when another screenshot is picked', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const tabs = page.getByRole('tablist', { name: 'Build sidebar' })
    await tabs.getByRole('tab', { name: /^Comments/ }).click()
    await expect
      .element(tabs.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await list.getByRole('link', { name: /checkout \/ address/ }).click()
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'checkout / address' }))
      .toBeVisible()
    await expect
      .element(tabs.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('offers Details, Activity and Comments, and arrow keys move between them', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const tabs = page.getByRole('tablist', { name: 'Build sidebar' })
    await expect.element(tabs).toBeVisible()
    await expect
      .element(tabs.getByRole('tab', { name: 'Details' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(page.getByRole('tabpanel')).toBeVisible()

    await tabs.getByRole('tab', { name: 'Details' }).click()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(tabs.getByRole('tab', { name: 'Activity' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(tabs.getByRole('tab', { name: 'Activity' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(tabs.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(page.getByRole('textbox', { name: 'Comment' })).toBeVisible()
  })

  it('Details lists per-snapshot decisions by snapshot, and marks the selected one', async () => {
    const max = { id: 'u3', name: 'Max Member', image: null }
    fakeBuildApi(
      detail(
        {},
        {
          diffs: [
            shot('checkout / payment', 'changed', {
              review: { ...decision('rejected', 'Wrong colour'), reviewer: max },
            }),
            shot('pricing', 'unchanged', { review: { ...decision('approved'), reviewer: max } }),
            shot('about', 'unchanged'),
          ],
          reviews: [
            {
              state: 'rejected',
              source: 'ui',
              reason: null,
              userName: 'Olivia Owner',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ),
    )
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const panel = page.getByRole('tabpanel')
    const items = () => panel.getByRole('listitem')
    const textOf = (hasText: string) => () => items().filter({ hasText }).element().textContent
    await expect.poll(textOf('Olivia Owner')).toMatch(/Rejected by Olivia Owner/)
    const pricing = items().filter({ hasText: 'pricing' })
    await expect.poll(textOf('pricing')).toMatch(/Approved by Max Member/)
    const payment = items().filter({ hasText: 'checkout / payment' })
    await expect.poll(textOf('checkout / payment')).toMatch(/Rejected by Max Member/)
    expect(pricing.element()).not.toHaveAttribute('aria-current')
    await expect.element(payment).toHaveAttribute('aria-current', 'true')
    expect(panel.getByText('about').elements()).toHaveLength(0)
  })

  it("shows the timeline with a rejection's reason and who did what", async () => {
    const api = fakeBuildApi(detail())
    api.activity = [
      { type: 'uploaded', at: at(90) },
      { type: 'completed', at: at(88) },
      {
        type: 'review_requested',
        at: at(60),
        reviewer: { id: 'u2', name: 'Grace Hopper', image: null },
        by: { id: 'u1', name: 'Ada Lovelace', image: null },
      },
      {
        type: 'review',
        at: at(30),
        state: 'rejected',
        source: 'ui',
        reason: 'The button lost its focus ring',
        by: { id: 'u2', name: 'Grace Hopper', image: null },
      },
    ]
    await renderBuild()
    await page.getByRole('tab', { name: 'Activity' }).click()
    const list = page.getByRole('list', { name: 'Activity' })
    await expect.element(list.getByText('The button lost its focus ring')).toBeVisible()
    await expect.element(list.getByText('Build uploaded')).toBeVisible()
    await expect.element(list.getByText(/requested Grace Hopper to review/)).toBeVisible()
    await expect.element(list.getByText('30 minutes ago')).toBeVisible()
    await expect.element(list.getByRole('img', { name: 'Grace Hopper' })).toBeVisible()
  })
})

describe('j and k', () => {
  it('select the next screenshot and move focus to its row together', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('j')
    const address = page.getByRole('link', { name: /checkout \/ address/ })
    await expect.element(address).toHaveFocus()
    await expect.element(address).toHaveAttribute('aria-current', 'page')
    await userEvent.keyboard('k')
    const payment = page.getByRole('link', { name: /checkout \/ payment/ })
    await expect.element(payment).toHaveFocus()
    await expect.element(payment).toHaveAttribute('aria-current', 'page')
  })
})

const unchanged = () => page.getByRole('button', { name: /^Unchanged/ })

describe('j and k with collapsed groups', () => {
  it("stop on a collapsed group's header, Enter opens it, and the next j enters it", async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('jj')
    await expect.element(page.getByRole('link', { name: /home/ })).toHaveFocus()
    await userEvent.keyboard('j')
    // The collapsed group is a stop, not skipped; nothing changed in the selection.
    await expect.element(unchanged()).toHaveFocus()
    await expect.element(unchanged()).toHaveAttribute('aria-expanded', 'false')
    await expect.element(page.getByRole('link', { name: /home/ })).toHaveAttribute('data-selected')
    await userEvent.keyboard('{Enter}')
    await expect.element(unchanged()).toHaveAttribute('aria-expanded', 'true')
    await expect.element(unchanged()).toHaveFocus()
    await userEvent.keyboard('j')
    const pricing = page.getByRole('link', { name: /pricing/ })
    await expect.element(pricing).toHaveFocus()
    await expect.element(pricing).toHaveAttribute('aria-current', 'page')
  })

  it('K comes back to the header, and Right opens it, Left closes it', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await userEvent.keyboard('jjj')
    await expect.element(unchanged()).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(unchanged()).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(unchanged()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('k')
    await expect.element(page.getByRole('link', { name: /home/ })).toHaveFocus()
  })
})

describe('comments', () => {
  it('invites the first comment, without a button', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await userEvent.keyboard('c')
    await expectEmptyState('No comments yet', {
      body: 'Press C to write one, or drag over a screenshot to comment on a region.',
    })
  })

  it('c opens Comments with the field focused, and @ suggests members', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('c')
    const field = page.getByRole('textbox', { name: 'Comment' })
    await expect.element(field).toHaveFocus()

    await field.fill('Looks off, @gr')
    const option = page.getByRole('option', { name: /Grace Hopper/ })
    await expect.element(option).toBeVisible()
    expect(page.getByRole('option', { name: /Ada Lovelace/ }).elements()).toHaveLength(0)
    await userEvent.keyboard('{Enter}')
    await expect.element(field).toHaveValue('Looks off, @grace ')
    expect(api.commentPosts).toEqual([])

    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await vi.waitFor(() => expect(api.commentPosts).toEqual([{ body: 'Looks off, @grace' }]))
    // The posted comment first shows the raw body, then the mention resolved to the member's name.
    await expect
      .element(
        page
          .getByRole('list', { name: 'Comments' })
          .getByText(/^Looks off, @(grace|Grace Hopper)$/),
      )
      .toBeVisible()
  })

  it('shows replies, and edit and delete only where they are allowed', async () => {
    const api = fakeBuildApi(detail())
    api.comments = [
      comment('a'),
      comment('b', {
        parentId: 'a',
        mine: true,
        canDelete: true,
        author: { id: 'u1', name: 'Ada Lovelace', image: null },
      }),
    ]
    await renderBuild()
    await page.getByRole('tab', { name: /^Comments/ }).click()
    const list = page.getByRole('list', { name: /^Comments/ })
    await expect.element(list.getByText('body a')).toBeVisible()
    await expect.element(list.getByText('body b')).toBeVisible()
    // Only the reply is Ada's own.
    expect(list.getByRole('button', { name: 'Edit' }).elements()).toHaveLength(1)
    expect(list.getByRole('button', { name: 'Delete' }).elements()).toHaveLength(1)
  })
})

describe('replying', () => {
  it('moves focus into the reply box, so typing never reaches a shortcut', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    api.comments = [comment('a')]
    await renderBuild()
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await page.getByRole('button', { name: 'Reply' }).click()
    const box = page.getByRole('textbox', { name: 'Reply' })
    await expect.element(box).toHaveFocus()
    // The QA path: type without clicking the box. A capital A is Approve all.
    await userEvent.keyboard('A reply')
    await expect.element(box).toHaveValue('A reply')
    expect(api.reviews).toEqual([])
  })

  it('ignores shortcut keys while a reply has text, even with focus elsewhere', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    api.comments = [comment('a')]
    await renderBuild()
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await page.getByRole('button', { name: 'Reply' }).click()
    const box = page.getByRole('textbox', { name: 'Reply' })
    await box.fill('half a thought')
    // Focus leaves the box (a click on the page background); the unsent text still holds the keys.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await expect.poll(() => api.reviews).toEqual([])
    await expect.element(page.getByRole('dialog', { name: /Reject/ })).not.toBeInTheDocument()
  })
})

describe('mentions in a comment', () => {
  it('are drawn as mentions, and plain text stays plain', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    api.comments = [comment('a', { body: 'Please look, @grace, and @nobody too' })]
    await renderBuild()
    await page.getByRole('tab', { name: /^Comments/ }).click()
    await expect
      .element(page.getByText('@Grace Hopper', { exact: true }))
      .toHaveAttribute('data-mention', '')
    // The name is shown; the handle is only what is stored.
    expect(page.getByText('@grace', { exact: true }).elements()).toHaveLength(0)
    await expect.element(page.getByText(/@nobody/)).toBeVisible()
    expect(
      page
        .getByText('@nobody')
        .elements()
        .every((e) => !e.hasAttribute('data-mention')),
    ).toBe(true)
  })
})

describe('a link to a comment', () => {
  it("opens the Comments tab, shows the comment's snapshot and marks the thread", async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    api.comments = [
      comment('a'),
      comment('c1', {
        snapshotName: 'checkout / address',
        region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        body: 'Pinned here',
      }),
    ]
    await renderBuild('/acme/web-app/builds/7?sidebar=comments&comment=c1')
    await expect
      .element(page.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(page.getByRole('link', { name: /checkout \/ address/ }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(page.getByText('Pinned here')).toBeVisible()
    await expect
      .element(
        page
          .getByRole('list', { name: /^Comments/ })
          .getByRole('listitem')
          .nth(1),
      )
      .toHaveAttribute('data-focused', '')
    // A thread reached with the keyboard has the standard 2px focus outline.
    const thread = page
      .getByRole('list', { name: /^Comments/ })
      .getByRole('listitem')
      .nth(1)
      .element()
    await userEvent.keyboard('{Shift}')
    thread.setAttribute('tabindex', '0')
    thread.focus()
    expect(thread.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(thread).outlineStyle).toBe('solid')
    expect(getComputedStyle(thread).outlineWidth).toBe('2px')
  })
})

describe('requesting a review', () => {
  it('lists who was asked under People in Details once the request is made', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByText(/Requested from/).elements()).toHaveLength(0)
    await userEvent.keyboard('{Shift>}R{/Shift}')
    const dialog = page.getByRole('dialog', { name: /^Request review from/ })
    // The server records the request; the activity the picker reads then lists it.
    api.activity = [
      {
        type: 'review_requested',
        at: new Date().toISOString(),
        reviewer: { id: 'u2', name: 'Grace Hopper', image: null },
        by: { id: 'u1', name: 'Ada Lovelace', image: null },
      },
    ]
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    const people = page.getByRole('tabpanel').getByRole('region', { name: 'People' })
    await expect.element(people.getByText('Grace Hopper')).toBeVisible()
    await expect.element(people.getByText(/Asked by Ada Lovelace/)).toBeVisible()
    // Not in the header any more.
    expect(page.getByText(/Requested from/).elements()).toHaveLength(0)
  })
})

describe('requesting a review, the picker', () => {
  it('shift-r opens a member picker and asks the chosen member', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('{Shift>}R{/Shift}')
    const dialog = page.getByRole('dialog', { name: /^Request review from/ })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await vi.waitFor(() =>
      expect(api.requests).toEqual([{ buildIds: [expect.any(String)], reviewerIds: ['u2'] }]),
    )
    await expect.element(toastNamed('Asked Grace Hopper to review')).toBeVisible()
    await expect.element(dialog).not.toBeInTheDocument()
  })
})

describe('compare modes', () => {
  it('offers four modes, and key 5 does nothing until the Design mode is enabled', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const view = page.getByRole('group', { name: 'View' })
    expect(view.getByRole('button').elements()).toHaveLength(4)
    await userEvent.keyboard('5')
    expect(router.state.location.search).not.toHaveProperty('mode')
    await userEvent.keyboard('2')
    await vi.waitFor(() => expect(router.state.location.search).toHaveProperty('mode', 'overlay'))
  })
})
