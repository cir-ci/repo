import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ShortcutLayer, useShortcutLayer } from '../../../src/app/ShortcutLayer.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, restoreFetch } from '../fetch-routes.ts'

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

const api = (
  search: unknown = { query: '', builds: [], branches: [], projects: [], snapshots: [] },
) =>
  fakeApi({
    'GET /api/projects': {
      body: {
        projects: [
          {
            org: { slug: 'acme', name: 'Acme' },
            project: { slug: 'web', name: 'Web', defaultBranch: 'main' },
            latestBuild: null,
          },
        ],
      },
    },
    'GET /api/capabilities': { body: { manageableOrganizations: [] } },
    'GET /api/orgs/acme/sidebar': {
      body: {
        projects: [{ slug: 'web', name: 'Web', pinned: true, triage: 0 }],
        views: [],
        inboxUnread: 0,
        reviews: 0,
      },
    },
    'GET /api/orgs/acme/search': { body: search },
  })

const result = {
  query: '#148',
  builds: [
    {
      projectSlug: 'web',
      projectName: 'Web',
      number: 148,
      name: 'Checkout',
      branch: 'main',
      prNumber: null,
      status: 'complete',
      reviewStatus: 'pending',
    },
  ],
  branches: [],
  projects: [{ slug: 'web', name: 'Web' }],
  snapshots: [],
}

const seen = async (target: { element?: unknown } & Parameters<typeof expect.element>[0]) => {
  await expect.element(target).toBeVisible()
}

function Opener() {
  const { openCommandMenu } = useShortcutLayer()
  return (
    <button type="button" onClick={openCommandMenu}>
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
    expect(calls.calls.some((c) => c.path === '/api/orgs/acme/search')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('walks the results with the arrows, wrapping, and → opens a quick look', async () => {
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
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('region', { name: 'Quick look' })).toBeVisible()
    await expect.element(page.getByText('Awaiting review')).toBeVisible()
  })

  it('lists the jump-to entries and pinned projects while the field is empty', async () => {
    api()
    await show()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await Promise.all(
      ['Inbox', 'Reviews', 'Projects', 'Insights', 'Settings'].map((name) =>
        seen(page.getByRole('option', { name: new RegExp(`^${name}`) })),
      ),
    )
    await expect.element(page.getByRole('option', { name: /Web/ })).toBeVisible()
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
})
