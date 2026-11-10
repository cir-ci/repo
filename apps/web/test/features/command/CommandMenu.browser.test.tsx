import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ShortcutLayer } from '#app/ShortcutLayer.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

const none = {
  baselines: [],
  triage: [],
  notifications: [],
  reviews: [],
  views: [],
}

const api = (
  search: unknown = { query: '', builds: [], branches: [], teams: [], snapshots: [], ...none },
) =>
  fakeApi({
    'GET /api/teams': {
      body: {
        teams: [
          {
            workspace: { slug: 'acme', name: 'Acme', role: 'owner' },
            team: { slug: 'web', name: 'Web', defaultBranch: 'main' },
            latestBuild: null,
          },
        ],
      },
    },
    'GET /api/capabilities': { body: { manageableWorkspaces: [] } },
    'GET /api/workspaces/acme/sidebar': {
      body: {
        teams: [{ slug: 'web', name: 'Web', pinned: true, triage: 0 }],
        views: [],
        inboxUnread: 0,
        reviews: 0,
      },
    },
    'GET /api/workspaces/acme/search': { body: search },
  })

const result = {
  query: '#148',
  builds: [
    {
      teamSlug: 'web',
      teamName: 'Web',
      number: 148,
      name: 'Checkout',
      branch: 'main',
      prNumber: null,
      status: 'complete',
      reviewStatus: 'pending',
    },
  ],
  branches: [],
  teams: [{ slug: 'web', name: 'Web' }],
  snapshots: [],
  ...none,
}

const more = {
  query: 'summary',
  builds: [],
  branches: [],
  teams: [],
  snapshots: [],
  baselines: [{ teamSlug: 'web', teamName: 'Web', name: 'checkout/summary', buildNumber: 140 }],
  triage: [
    {
      teamSlug: 'web',
      teamName: 'Web',
      kind: 'flaky',
      key: 'checkout/summary',
      snapshotName: 'checkout/summary',
      buildNumber: 150,
      branch: 'main',
    },
  ],
  notifications: [
    {
      id: 'n1',
      kind: 'mentioned',
      tab: 'everything',
      read: false,
      createdAt: '2026-03-10T12:00:00.000Z',
      actor: { name: 'Ada' },
      build: { number: 148, name: 'default' },
      team: { slug: 'web', name: 'Web' },
      payload: { snippet: 'the summary is cut off' },
    },
  ],
  reviews: [
    {
      id: 'r1',
      tab: 'for-you',
      teamSlug: 'web',
      teamName: 'Web',
      build: { number: 148, name: 'default', branch: 'main' },
      reviewer: { name: 'Me' },
      requestedBy: { name: 'Ada' },
    },
  ],
  views: [],
}

const seen = async (target: { element?: unknown } & Parameters<typeof expect.element>[0]) => {
  await expect.element(target).toBeVisible()
}

function Opener() {
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  return (
    <button type="button" onClick={() => setCommandMenuOpen(true)}>
      Search
    </button>
  )
}

const show = () =>
  renderPage(
    <ShortcutLayer>
      <Opener />
    </ShortcutLayer>,
    { announcer: true },
  )

describe('the command menu', () => {
  it('opens with ⌘K, finds build 148 by "#148" and ↵ opens it', async () => {
    const calls = api(result)
    const { router } = await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    const field = page.getByRole('combobox')
    await expect.element(field).toHaveFocus()
    await userEvent.type(field, '#148')
    await expect.element(page.getByRole('option', { name: /#148 Checkout/ })).toBeVisible()
    expect(calls.calls.some((c) => c.path === '/api/workspaces/acme/search')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('lists baselines, triage items, notifications and reviews in groups named for them, with a peek at each', async () => {
    await page.viewport(1200, 800)
    api(more)
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), 'summary')
    for (const group of ['Baselines', 'Triage', 'Inbox', 'Reviews']) {
      // eslint-disable-next-line no-await-in-loop -- one group after another
      await seen(page.getByRole('group', { name: group }))
    }
    await seen(page.getByRole('option', { name: /^checkout\/summary Web$/ }).first())
    await seen(page.getByRole('option', { name: /^Build #148 · main Web$/ }))
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await page.getByRole('option', { name: /^Build #148 · main/ }).hover()
    await expect.element(peek.getByText('Requested from you')).toBeVisible()
    await page.getByRole('option', { name: /^Ada mentioned you/ }).hover()
    await expect.element(peek.getByText('the summary is cut off')).toBeVisible()
    await page.getByRole('option', { name: /Flaky/ }).hover()
    await expect.element(peek.getByText('#150')).toBeVisible()
  })

  it.each([
    ['a notification', /^Ada mentioned you/, '/inbox', '?tab=everything&item=n1'],
    [
      'a review request',
      /^Build #148 · main/,
      '/workspaces/acme/reviews',
      '?tab=for-you&review=r1',
    ],
    ['a triage item', /Flaky/, '/acme/web/triage', '?item=flaky%3Acheckout%2Fsummary'],
    ['a baseline', /^checkout\/summary Web$/, '/acme/web/baselines/checkout/summary', ''],
  ])('opens %s with the item selected', async (_kind, name, pathname, search) => {
    api(more)
    const { router } = await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), 'summary')
    await page.getByRole('option', { name }).click()
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe(pathname)
      expect(router.state.location.searchStr).toBe(search)
    })
  })

  it('walks the results with the arrows, wrapping, and the peek pane follows the highlight', async () => {
    await page.viewport(1200, 800)
    api(result)
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), '148')
    const build = page.getByRole('option', { name: /#148 Checkout/ })
    await expect.element(build).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    await expect
      .element(page.getByRole('option', { name: /^Web/ }))
      .toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(build).toHaveAttribute('aria-selected', 'true')
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await expect.element(peek.getByText('Awaiting review')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(peek.getByText('Awaiting review')).not.toBeInTheDocument()
  })

  it('switches the theme from "theme" (the Appearance page points here)', async () => {
    api()
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), 'theme light')
    await expect.element(page.getByRole('option', { name: /Theme: Light/ })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(document.documentElement.dataset['circiColorScheme']).toBe('light'),
    )
    try {
      localStorage.removeItem('circi-color-mode')
    } catch {
      // Storage may be blocked; nothing to clean up then.
    }
  })

  it('lists the jump-to entries and pinned teams while the field is empty', async () => {
    api()
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await Promise.all(
      ['Inbox', 'Reviews', 'Teams', 'Insights', 'Settings'].map((name) =>
        seen(page.getByRole('option', { name: new RegExp(`^Open ${name}`) })),
      ),
    )
    await seen(page.getByRole('option', { name: /^Keyboard shortcuts/ }))
    await expect
      .element(page.getByRole('combobox'))
      .toHaveAttribute('placeholder', 'Search or run a command')
    await expect.element(page.getByRole('option', { name: /Web/ })).toBeVisible()
  })

  it('says what to try when nothing matches', async () => {
    api()
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), 'zzzq')
    await expect
      .element(page.getByText('Nothing matches “zzzq”. Try a build number like #148.'))
      .toBeVisible()
  })

  it('shows a chip for the build you are on, with its actions under Build #148, and clears it', async () => {
    api()
    await renderPage(
      <ShortcutLayer>
        <Opener />
      </ShortcutLayer>,
      { announcer: true, route: '/$workspace/$team/builds/$number', url: '/acme/web/builds/148' },
    )
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await expect.element(page.getByText('Web · #148')).toBeVisible()
    await expect.element(page.getByRole('group', { name: 'Build #148' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear context' }).click()
    await expect.element(page.getByText('Web · #148')).not.toBeInTheDocument()
    await expect.element(page.getByRole('group', { name: 'Build #148' })).not.toBeInTheDocument()
  })

  it('closes with Esc and gives focus back to the button that opened it', async () => {
    api()
    await show()
    const opener = page.getByRole('button', { name: 'Search' })
    await opener.click()
    await expect.element(page.getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('combobox')).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
  })
})

describe('the shortcuts help', () => {
  it('opens with ? from anywhere and lists the groups', async () => {
    api()
    await show()
    await userEvent.keyboard('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect.element(dialog).toBeVisible()
    await Promise.all(
      ['Navigation', 'General', 'Lists', 'Inbox'].map((group) =>
        seen(dialog.getByRole('region', { name: group })),
      ),
    )
  })

  it('opens from "Keyboard shortcuts" in the command menu, by Enter and by click', async () => {
    api()
    await show()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(page.getByRole('combobox'), 'keyboard shortcuts')
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await page.getByRole('option', { name: /^Keyboard shortcuts/ }).click()
    await expect.element(dialog).toBeVisible()
  })
})
