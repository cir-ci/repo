import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

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
  author: { id: 'u2', name: 'Grace Hopper' },
  createdAt: at(5),
  editedAt: null,
  deletedAt: null,
  mine: false,
  canDelete: false,
  ...over,
})

describe('sidebar tabs', () => {
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
    await expect.element(page.getByRole('combobox', { name: 'Comment' })).toBeVisible()
  })

  it('shows the timeline with a rejection’s reason and who did what', async () => {
    const api = fakeBuildApi(detail())
    api.activity = [
      { type: 'uploaded', at: at(90) },
      { type: 'completed', at: at(88) },
      {
        type: 'review_requested',
        at: at(60),
        reviewer: { id: 'u2', name: 'Grace Hopper' },
        by: { id: 'u1', name: 'Ada Lovelace' },
      },
      {
        type: 'review',
        at: at(30),
        state: 'rejected',
        source: 'ui',
        reason: 'The button lost its focus ring',
        by: { id: 'u2', name: 'Grace Hopper' },
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
  it('stop on a collapsed group’s header, Enter opens it, and the next j enters it', async () => {
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
  it('c opens Comments with the field focused, and @ suggests members', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('c')
    const field = page.getByRole('combobox', { name: 'Comment' })
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
    await expect.element(page.getByText('Looks off, @grace', { exact: true })).toBeVisible()
  })

  it('shows replies, and edit and delete only where they are allowed', async () => {
    const api = fakeBuildApi(detail())
    api.comments = [
      comment('a'),
      comment('b', {
        parentId: 'a',
        mine: true,
        canDelete: true,
        author: { id: 'u1', name: 'Ada Lovelace' },
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

describe('requesting a review', () => {
  it('shift-r opens a member picker and asks the chosen member', async () => {
    const api = fakeBuildApi(detail())
    api.members = [ada, grace]
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('{Shift>}R{/Shift}')
    const dialog = page.getByRole('dialog', { name: 'Request a review' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    await vi.waitFor(() => expect(api.requests).toEqual([{ reviewerId: 'u2' }]))
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
