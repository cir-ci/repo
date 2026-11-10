import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ShortcutLayer } from '#app/ShortcutLayer.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

const api = (search: unknown = { query: '', builds: [], branches: [], teams: [], snapshots: [] }) =>
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
