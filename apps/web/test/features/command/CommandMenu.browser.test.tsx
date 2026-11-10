import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { ShortcutLayer } from '#app/ShortcutLayer.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { RECENT_SEARCHES_KEY, useRecentSearchesStore } from '#lib/stores/recent-searches-store.ts'
import { RECENT_CAP, RECENT_KEY, useRecentStore } from '#lib/stores/recent-store.ts'
import { useSettingsReturnStore } from '#lib/stores/settings-return-store.ts'
import { clipboard } from '#lib/use-copy.ts'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { sidebarModel, sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

const totals = {
  builds: 0,
  branches: 0,
  teams: 0,
  snapshots: 0,
  baselines: 0,
  triage: 0,
  notifications: 0,
  reviews: 0,
  views: 0,
  people: 0,
}

const none = {
  baselines: [],
  triage: [],
  notifications: [],
  reviews: [],
  views: [],
  people: [],
  totals,
}

const empty = { query: '', builds: [], branches: [], teams: [], snapshots: [], ...none }

const web = sidebarTeam({ slug: 'web', name: 'Web', pinned: true })
const docs = sidebarTeam({ slug: 'docs', name: 'Docs' })

const overviewOf = (workspace: string, team: string, name: string) => ({
  workspace: { slug: workspace, name: workspace === 'acme' ? 'Acme' : 'Other', role: 'owner' },
  team: { slug: team, name, defaultBranch: 'main' },
  latestBuild: null,
})

const api = (
  search: unknown = empty,
  extra: Record<string, ReplyHandler> = {},
  sidebar: Parameters<typeof sidebarModel>[0] = {},
) => {
  const fake = fakeApi({
    'GET /api/teams': {
      body: {
        teams: [
          overviewOf('acme', 'web', 'Web'),
          overviewOf('acme', 'docs', 'Docs'),
          overviewOf('other', 'site', 'Site'),
        ],
      },
    },
    'GET /api/capabilities': { body: { manageableWorkspaces: [] } },
    'GET /api/workspaces/acme/sidebar': {
      body: sidebarModel({ teams: [web, docs], ...sidebar }),
    },
    'GET /api/workspaces/acme/search': { body: search },
    ...extra,
  })
  // The fake keys by path; the search's own address says which team and kinds were asked for.
  const urls: string[] = []
  const send = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return send(input, init)
  })
  return { ...fake, searches: () => urls.filter((u) => u.includes('/search?')) }
}

const build = (over: Record<string, unknown> = {}) => ({
  teamSlug: 'web',
  teamName: 'Web',
  number: 148,
  name: 'Checkout',
  branch: 'main',
  prNumber: null,
  status: 'complete',
  reviewStatus: 'pending',
  changes: { changed: 0, added: 0, removed: 0 },
  thumbnail: null,
  ...over,
})

const found = (over: Record<string, unknown> = {}) => ({ ...empty, query: 'checkout', ...over })

const more = {
  ...empty,
  query: 'summary',
  baselines: [
    {
      teamSlug: 'web',
      teamName: 'Web',
      name: 'checkout/summary',
      buildNumber: 140,
      thumbnail: null,
      approvedBy: null,
    },
  ],
  triage: [
    {
      teamSlug: 'web',
      teamName: 'Web',
      kind: 'flaky',
      key: 'checkout/summary',
      snapshotName: 'checkout/summary',
      buildNumber: 150,
      branch: 'main',
      assignee: null,
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
      requestedBy: { name: 'Dana Levi' },
      createdAt: '2026-03-10T12:00:00.000Z',
    },
  ],
  totals: { ...totals, baselines: 1, triage: 1, notifications: 1, reviews: 1 },
}

function Opener() {
  const setCommandMenuOpen = useOverlayStore((s) => s.setCommandMenuOpen)
  return (
    <button type="button" onClick={() => setCommandMenuOpen(true)}>
      Search
    </button>
  )
}

const show = (url?: string, route?: string) =>
  renderPage(
    <ShortcutLayer>
      <Opener />
    </ShortcutLayer>,
    { announcer: true, viewport: [1200, 800], ...(url ? { url, route: route ?? url } : {}) },
  )

const onBuild = () => show('/acme/web/builds/148', '/$workspace/$team/builds/$number')

const toast = () => page.getByRole('group', { name: 'Last change' })
const openMenu = () => userEvent.keyboard('{Meta>}k{/Meta}')
const field = () => page.getByRole('combobox')

describe('the command menu, empty', () => {
  it('lists pages as plain nouns under Go to, with the registry keys, and no "Open …"', async () => {
    api()
    await show()
    await openMenu()
    const goTo = page.getByRole('group', { name: 'Go to' })
    for (const name of ['Inbox', 'Reviews', 'Triage', 'Teams', 'Insights', 'Settings']) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(goTo.getByRole('option', { name, exact: true })).toBeVisible()
    }
    await expect.element(page.getByText(/^Open /)).not.toBeInTheDocument()
    await expect.element(goTo.getByRole('option', { name: 'Team Web' })).toBeVisible()
    await expect.element(field()).toHaveAttribute('placeholder', 'Search or type a command')
  })

  it('draws an action with a verb and its keys, and no kind label', async () => {
    api()
    await onBuild()
    await openMenu()
    const group = page.getByRole('group', { name: 'Build #148' })
    const approve = group.getByRole('option', { name: 'Approve all' })
    await expect.element(approve).toBeVisible()
    await expect.element(approve.getByText('⇧')).toBeVisible()
    await expect.element(approve.getByText('Build', { exact: true })).not.toBeInTheDocument()
  })

  it('lists Needs you from the sidebar counts, and Switch and change with chevrons', async () => {
    api(empty, {}, { reviews: 3, inboxUnread: 1, triageAssigned: 2 })
    await show()
    await openMenu()
    const needs = page.getByRole('group', { name: 'Needs you' })
    await expect
      .element(needs.getByRole('option', { name: /3 reviews waiting on you/ }))
      .toBeVisible()
    await expect
      .element(needs.getByRole('option', { name: /2 triage items assigned to you/ }))
      .toBeVisible()
    await expect.element(needs.getByRole('option', { name: /1 unread notice/ })).toBeVisible()
    const change = page.getByRole('group', { name: 'Switch and change' })
    for (const name of [
      'Switch team…',
      'Switch workspace…',
      'Theme…',
      'Keyboard shortcuts',
      'Sign out',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(change.getByRole('option', { name })).toBeVisible()
    }
  })

  it('lists Recent for this workspace only, newest first, with relative times', async () => {
    api()
    await renderPage(
      <ShortcutLayer>
        <Opener />
      </ShortcutLayer>,
      {
        announcer: true,
        viewport: [1200, 800],
        beforeRender: () => {
          const { record } = useRecentStore.getState()
          const hour = 3_600_000
          record('acme', {
            kind: 'build',
            id: 'build:web:140',
            label: 'Build #140',
            detail: 'Web',
            path: '/acme/web/builds/140',
            at: Date.now() - 2 * hour,
          })
          record('other', {
            kind: 'build',
            id: 'build:site:9',
            label: 'Build #9',
            path: '/other/site/builds/9',
            at: Date.now(),
          })
        },
      },
    )
    await openMenu()
    const recent = page.getByRole('group', { name: 'Recent' })
    await expect.element(recent.getByRole('option', { name: /Build #140/ })).toBeVisible()
    await expect.element(recent.getByText('2 h ago')).toBeVisible()
    await expect.element(page.getByText('Build #9')).not.toBeInTheDocument()
  })

  it('records the builds you visit, per workspace, in the browser', async () => {
    api()
    await onBuild()
    await vi.waitFor(() => {
      expect(useRecentStore.getState().byWorkspace['acme']?.[0]).toMatchObject({
        kind: 'build',
        id: 'build:web:148',
      })
    })
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}')).toHaveProperty('acme')
    expect(RECENT_CAP).toBeGreaterThan(8)
  })

  it('does not break when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    api()
    await onBuild()
    await vi.waitFor(() => {
      expect(useRecentStore.getState().byWorkspace['acme']).toHaveLength(1)
    })
    await openMenu()
    await expect.element(field()).toHaveFocus()
  })
})

describe('typing', () => {
  it('finds build 148 by "#148": the # becomes a Builds chip, only builds are asked for, and ↵ goes there', async () => {
    const calls = api(found({ builds: [build()] }))
    const { router } = await show()
    await openMenu()
    await expect.element(field()).toHaveFocus()
    await userEvent.type(field(), '#148')
    await expect.element(page.getByRole('button', { name: 'Remove Builds scope' })).toBeVisible()
    await expect.element(field()).toHaveAttribute('placeholder', 'Search builds')
    await expect.element(page.getByRole('option', { name: /Build #148 Checkout/ })).toBeVisible()
    expect(calls.searches().at(-1)).toContain('kinds=builds')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('shows every kind with its own icon label, and a peek line for each', async () => {
    api(more)
    await show()
    await openMenu()
    await userEvent.type(field(), 'summary')
    for (const group of ['Baselines', 'Triage', 'Inbox', 'Review requests']) {
      // eslint-disable-next-line no-await-in-loop -- one group after another
      await expect.element(page.getByRole('group', { name: group })).toBeVisible()
    }
    await expect
      .element(page.getByRole('option', { name: /^Baseline checkout\/summary/ }))
      .toBeVisible()
    await expect
      .element(page.getByRole('option', { name: /^Review request Review #148, from Dana Levi/ }))
      .toBeVisible()
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await page.getByRole('option', { name: /^Triage checkout\/summary/ }).hover()
    await expect.element(peek.getByText('Flaky on main.')).toBeVisible()
    await page.getByRole('option', { name: /^Inbox Ada mentioned you/ }).hover()
    await expect.element(peek.getByText('the summary is cut off')).toBeVisible()
    await page.getByRole('option', { name: /^Review request/ }).hover()
    await expect.element(peek.getByText('Dana Levi asked Me to review it.')).toBeVisible()
  })

  it.each([
    ['a notification', /^Inbox Ada mentioned you/, '/inbox', '?tab=everything&item=n1'],
    [
      'a review request',
      /^Review request Review #148/,
      '/workspaces/acme/reviews',
      '?tab=for-you&review=r1',
    ],
    [
      'a triage item',
      /^Triage checkout\/summary/,
      '/acme/web/triage',
      '?item=flaky%3Acheckout%2Fsummary',
    ],
    ['a baseline', /^Baseline checkout\/summary/, '/acme/web/baselines/checkout/summary', ''],
  ])('opens %s with the item selected', async (_kind, name, pathname, search) => {
    api(more)
    const { router } = await show()
    await openMenu()
    await userEvent.type(field(), 'summary')
    await page.getByRole('option', { name }).click()
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe(pathname)
      expect(router.state.location.searchStr).toBe(search)
    })
  })

  it('ranks a clear best match first, with no heading, and caps a kind at 3 with "Show all 12 builds"', async () => {
    api(
      found({
        builds: [
          build({ number: 148, name: 'Checkout' }),
          build({ number: 147, name: 'Cart' }),
          build({ number: 146, name: 'Nav' }),
          build({ number: 145, name: 'Footer' }),
        ],
        totals: { ...totals, builds: 12 },
      }),
    )
    await show()
    await openMenu()
    await userEvent.type(field(), '148')
    const options = page.getByRole('option')
    await expect.element(options.first()).toHaveAttribute('aria-selected', 'true')
    await expect.element(options.first()).toHaveAccessibleName(/Build #148 Checkout/)
    await userEvent.clear(field())
    await userEvent.type(field(), 'che')
    await expect.element(page.getByRole('option', { name: 'Show all 12 builds' })).toBeVisible()
    await expect.element(page.getByRole('option', { name: /Build #145/ })).not.toBeInTheDocument()
    await page.getByRole('option', { name: 'Show all 12 builds' }).click()
    await expect.element(page.getByRole('button', { name: 'Remove Builds scope' })).toBeVisible()
  })

  it('says what was not found, with ways on, and the build number tip', async () => {
    api()
    await show()
    await openMenu()
    await userEvent.type(field(), 'zzzq')
    await expect.element(page.getByText(/No results for "zzzq"\./)).toBeVisible()
    await expect.element(page.getByText('Try a build number like #148.')).toBeVisible()
    await expect.element(page.getByRole('option', { name: 'Show all builds' })).toBeVisible()
    await page.getByRole('option', { name: 'Show all pages' }).click()
    await expect.element(field()).toHaveValue('')
    await expect.element(page.getByRole('group', { name: 'Go to' })).toBeVisible()
  })

  it('says it could not search, keeps local rows and retries', async () => {
    let fail = true
    const calls = api(empty, {
      'GET /api/workspaces/acme/search': () =>
        fail ? { status: 500, body: {} } : { body: found({ builds: [build()] }) },
    })
    await show()
    await openMenu()
    await userEvent.type(field(), 'inbox')
    await expect
      .element(page.getByText("Couldn't search. Check your connection and try again."))
      .toBeVisible()
    await expect.element(page.getByRole('option', { name: 'Inbox', exact: true })).toBeVisible()
    fail = false
    await page.getByRole('option', { name: 'Try again' }).click()
    await vi.waitFor(() => expect(calls.searches().length).toBeGreaterThan(1))
  })

  it('walks the results with the arrows, wrapping, and the peek follows the highlight', async () => {
    api(found({ builds: [build()], teams: [{ slug: 'web', name: 'Web' }] }))
    await show()
    await openMenu()
    await userEvent.type(field(), '148')
    const buildRow = page.getByRole('option', { name: /Build #148 Checkout/ })
    await expect.element(buildRow).toHaveAttribute('aria-selected', 'true')
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await expect.element(peek.getByText('Needs review. Awaiting review.')).toBeVisible()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(buildRow).not.toHaveAttribute('aria-selected', 'true')
  })

  it('wires the combobox, the listbox and the live count', async () => {
    api(found({ builds: [build(), build({ number: 147, name: 'Cart' })] }))
    await show()
    await openMenu()
    const input = field()
    await expect.element(input).toHaveAttribute('aria-expanded', 'true')
    await expect.element(input).toHaveAttribute('aria-autocomplete', 'list')
    const listbox = page.getByRole('listbox')
    await expect.element(listbox).toBeVisible()
    await userEvent.type(input, 'check')
    const selected = page.getByRole('option', { selected: true })
    await expect.element(selected).toBeVisible()
    await expect.element(input).toHaveAttribute('aria-activedescendant', selected.element().id)
    await expect.element(page.getByText(/^\d+ results?$/)).toBeInTheDocument()
  })
})

describe('scope', () => {
  it('limits a team page to its team, and "Search all teams" widens it (⌘↵)', async () => {
    const calls = api(found({ builds: [build()] }))
    await onBuild()
    await openMenu()
    await expect.element(page.getByText('Web · #148')).toBeVisible()
    await userEvent.type(field(), 'checkout')
    await expect.element(page.getByRole('option', { name: /Build #148 Checkout/ })).toBeVisible()
    expect(calls.searches().at(-1)).toContain('team=web')
    const widen = page.getByRole('option', { name: 'Search all teams for "checkout"' })
    await expect.element(widen).toBeVisible()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.element(page.getByText('Web · #148')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(calls.searches().at(-1)).not.toContain('team='))
    await expect.element(widen).not.toBeInTheDocument()
  })

  it('removes the page chip with its button, and with Backspace in the empty field', async () => {
    api()
    await onBuild()
    await openMenu()
    await expect.element(page.getByRole('group', { name: 'Build #148' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Web scope' }).click()
    await expect.element(page.getByText('Web · #148')).not.toBeInTheDocument()
    await expect.element(page.getByRole('group', { name: 'Build #148' })).not.toBeInTheDocument()
  })

  it('turns in:name into a team chip, completes it with Tab, and Backspace removes it', async () => {
    const calls = api(found({ builds: [build()] }))
    await show()
    await openMenu()
    await userEvent.type(field(), 'checkout in:do')
    await userEvent.keyboard('{Tab}')
    await expect.element(page.getByRole('button', { name: 'Remove Docs scope' })).toBeVisible()
    await expect.element(field()).toHaveValue('checkout')
    await vi.waitFor(() => expect(calls.searches().at(-1)).toContain('team=docs'))
    await userEvent.clear(field())
    await userEvent.keyboard('{Backspace}')
    await expect
      .element(page.getByRole('button', { name: 'Remove Docs scope' }))
      .not.toBeInTheDocument()
  })

  it('runs only commands after ">", and screenshots after "/"', async () => {
    const calls = api()
    await show()
    await openMenu()
    await userEvent.type(field(), '>theme')
    await expect.element(page.getByRole('button', { name: 'Remove Commands scope' })).toBeVisible()
    await expect.element(field()).toHaveAttribute('placeholder', 'Run a command')
    await expect.element(page.getByRole('option', { name: 'Theme…' })).toBeVisible()
    expect(calls.searches()).toEqual([])
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')
    await userEvent.keyboard('{Backspace}')
    await userEvent.type(field(), '/checkout')
    await vi.waitFor(() => expect(calls.searches().at(-1)).toContain('kinds=snapshots%2Cbaselines'))
    await expect.element(field()).toHaveAttribute('placeholder', 'Search screenshots')
  })
})

describe('people', () => {
  const dana = {
    id: 'u2',
    name: 'Dana Levi',
    email: 'dana@acme.test',
    image: null,
    teams: [
      { slug: 'web', name: 'Web' },
      { slug: 'docs', name: 'Docs' },
    ],
    openReviews: 2,
  }
  const people = { ...empty, query: 'dana', people: [dana], totals: { ...totals, people: 1 } }

  it('finds people after @, shows their teams and open reviews, and opens their review requests', async () => {
    const calls = api(people)
    const { router } = await show()
    await openMenu()
    await userEvent.type(field(), '@dana')
    await expect.element(page.getByRole('button', { name: 'Remove People scope' })).toBeVisible()
    await expect.element(field()).toHaveAttribute('placeholder', 'Search people')
    const row = page.getByRole('option', { name: /Person Dana Levi/ })
    await expect.element(row).toBeVisible()
    expect(calls.searches().at(-1)).toContain('kinds=people')
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await expect.element(peek.getByText('dana@acme.test')).toBeVisible()
    await expect.element(peek.getByText('Web, Docs')).toBeVisible()
    await expect.element(peek.getByText('2 requests')).toBeVisible()
    await expect.element(peek.getByRole('img', { name: 'Dana Levi' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/workspaces/acme/reviews')
      expect(router.state.location.search).toMatchObject({ tab: 'all-open', q: 'Dana Levi' })
    })
  })

  it('lists people in their own group among the other results', async () => {
    api({
      ...found({ builds: [build()] }),
      people: [dana, { ...dana, id: 'u3', name: 'Dana Cole', email: 'cole@acme.test' }],
      totals: { ...totals, builds: 1, people: 2 },
    })
    await show()
    await openMenu()
    await userEvent.type(field(), 'dana')
    const group = page.getByRole('group', { name: 'People' })
    await expect.element(group.getByRole('option', { name: /Dana Levi/ })).toBeVisible()
    await expect.element(group.getByRole('option', { name: /Dana Cole/ })).toBeVisible()
  })
})

describe('peeks', () => {
  it('draws the largest change of a build and its change counts', async () => {
    api(
      found({
        builds: [
          build({ changes: { changed: 3, added: 1, removed: 0 }, thumbnail: 'ab'.repeat(32) }),
        ],
      }),
    )
    await show()
    await openMenu()
    await userEvent.type(field(), 'checkout')
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await expect.element(peek.getByText('3 changed, 1 added')).toBeVisible()
    expect(peek.element().querySelector('img')?.getAttribute('src')).toBe(
      `/api/files/${'ab'.repeat(32)}`,
    )
  })

  it('names the approver of a baseline, the assignee of a triage item and the age of a request', async () => {
    api({
      ...more,
      baselines: [{ ...more.baselines[0], approvedBy: 'Grace Hopper', thumbnail: 'cd'.repeat(32) }],
      triage: [{ ...more.triage[0], assignee: { name: 'Ada' } }],
    })
    await show()
    await openMenu()
    await userEvent.type(field(), 'summary')
    const peek = page.getByRole('complementary', { name: 'Peek' })
    await page.getByRole('option', { name: /Baseline checkout\/summary/ }).hover()
    await expect.element(peek.getByText('Grace Hopper')).toBeVisible()
    await page.getByRole('option', { name: /Triage checkout\/summary/ }).hover()
    await expect.element(peek.getByText('Assignee')).toBeVisible()
    await expect.element(peek.getByText('Ada')).toBeVisible()
    await page.getByRole('option', { name: /Review #148/ }).hover()
    await expect.element(peek.getByText('Asked')).toBeVisible()
  })
})

describe('Create entries', () => {
  it('offers New team, New workspace and Invite people, and opens the dialogs', async () => {
    api(empty, {
      'GET /api/capabilities': { body: { manageableWorkspaces: [], canCreateWorkspace: true } },
    })
    const { router } = await show()
    await openMenu()
    const change = page.getByRole('group', { name: 'Switch and change' })
    await expect.element(change.getByRole('option', { name: 'New workspace' })).toBeVisible()
    await change.getByRole('option', { name: 'New team' }).click()
    await vi.waitFor(() => expect(useOverlayStore.getState().newTeamOpen).toBe(true))
    await openMenu()
    await page.getByRole('option', { name: 'New workspace' }).click()
    await vi.waitFor(() => expect(useOverlayStore.getState().newWorkspaceOpen).toBe(true))
    // Invite people is an entry point to the Members page.
    await openMenu()
    await page.getByRole('option', { name: 'Invite people' }).click()
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/acme/settings/members'),
    )
  })

  it('leaves them out for someone who may not manage the workspace or create workspaces', async () => {
    api(empty, {}, { canManage: false })
    await show()
    await openMenu()
    await expect.element(page.getByRole('option', { name: 'Theme…' })).toBeVisible()
    for (const name of ['New team', 'New workspace', 'Invite people']) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(page.getByRole('option', { name })).not.toBeInTheDocument()
    }
  })

  it('offers none inside settings', async () => {
    api()
    await inSettings()
    await openMenu()
    await userEvent.type(field(), 'new team')
    await expect.element(page.getByRole('option', { name: 'New team' })).not.toBeInTheDocument()
  })
})

describe('recent searches', () => {
  it('remembers what was typed when a result is chosen, lists it under Recent, retypes and clears it', async () => {
    api(found({ builds: [build()] }))
    await onBuild()
    await openMenu()
    await userEvent.type(field(), 'checkout')
    await expect.element(page.getByRole('option', { name: /Build #148/ })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(useRecentSearchesStore.getState().byWorkspace['acme']).toEqual(['checkout']),
    )
    expect(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '{}')).toEqual({
      acme: ['checkout'],
    })
    await openMenu()
    const recent = page.getByRole('group', { name: 'Recent' })
    await expect.element(recent.getByRole('option', { name: /Search checkout/ })).toBeVisible()
    await recent.getByRole('option', { name: /Search checkout/ }).click()
    await expect.element(field()).toHaveValue('checkout')
    await userEvent.clear(field())
    await recent.getByRole('option', { name: 'Clear recent searches' }).click()
    await expect
      .element(page.getByRole('option', { name: /Search checkout/ }))
      .not.toBeInTheDocument()
    expect(useRecentSearchesStore.getState().byWorkspace['acme']).toBeUndefined()
  })

  it('keeps them per workspace and does not break when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    api(found({ builds: [build()] }))
    await renderPage(
      <ShortcutLayer>
        <Opener />
      </ShortcutLayer>,
      {
        announcer: true,
        viewport: [1200, 800],
        beforeRender: () => useRecentSearchesStore.getState().record('other', 'elsewhere'),
      },
    )
    await openMenu()
    await expect
      .element(page.getByRole('option', { name: /Search elsewhere/ }))
      .not.toBeInTheDocument()
    await userEvent.type(field(), 'checkout')
    await expect.element(page.getByRole('option', { name: /Build #148/ })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(useRecentSearchesStore.getState().byWorkspace['acme']).toEqual(['checkout']),
    )
  })
})

describe('on a phone', () => {
  it('is a bottom sheet with 44px rows, a grabber and room for the home indicator', async () => {
    api(found({ builds: [build()] }))
    await renderPage(
      <ShortcutLayer>
        <Opener />
      </ShortcutLayer>,
      { announcer: true, viewport: [390, 700] },
    )
    await page.getByRole('button', { name: 'Search' }).click()
    const dialog = page.getByRole('dialog', { name: 'Command menu' })
    await expect.element(dialog).toBeVisible()
    // It slides up from the bottom edge; once it has settled it sits on it.
    await vi.waitFor(() =>
      expect(Math.round(dialog.element().getBoundingClientRect().bottom)).toBe(700),
    )
    const box = dialog.element().getBoundingClientRect()
    expect(Math.round(box.left)).toBe(0)
    expect(Math.round(box.width)).toBe(390)
    const style = getComputedStyle(dialog.element())
    expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0)
    expect(style.borderBottomLeftRadius).toBe('0px')
    expect(style.paddingBottom).toBe('0px')
    const row = page.getByRole('option').first().element().getBoundingClientRect()
    expect(row.height).toBeGreaterThanOrEqual(44)
    const grabber = dialog.element().querySelector('span[aria-hidden="true"]')
    expect(grabber && getComputedStyle(grabber).display).toBe('block')
    // No side pane on a phone.
    const peek = dialog.element().querySelector('aside[aria-label="Peek"]')
    expect(peek && getComputedStyle(peek).display).toBe('none')
  })

  it('stays a centred dialog on a desktop', async () => {
    api()
    await show()
    await openMenu()
    const box = page.getByRole('dialog', { name: 'Command menu' }).element().getBoundingClientRect()
    expect(box.bottom).toBeLessThan(800)
    expect(box.width).toBeGreaterThan(700)
  })
})

describe('nested lists', () => {
  it('opens Switch team… as a list with the current team checked, and Backspace goes back', async () => {
    api()
    await onBuild()
    await openMenu()
    await page.getByRole('option', { name: 'Switch team…' }).click()
    await expect.element(page.getByText('Switch team', { exact: true })).toBeVisible()
    await expect.element(field()).toHaveAttribute('placeholder', 'Find a team')
    await expect.element(page.getByRole('option', { name: /^Web, Current/ })).toBeVisible()
    await expect.element(page.getByRole('option', { name: /^Docs/ })).toBeVisible()
    await expect.element(page.getByRole('group', { name: 'Go to' })).not.toBeInTheDocument()
    await expect.element(page.getByText('↵')).toBeVisible()
    await userEvent.keyboard('{Backspace}')
    await expect.element(field()).toHaveAttribute('placeholder', 'Search or type a command')
    await expect.element(page.getByRole('group', { name: 'Go to' })).toBeVisible()
  })

  it('goes back one list with Esc before it closes the menu', async () => {
    api()
    await show()
    await openMenu()
    await page.getByRole('option', { name: 'Theme…' }).click()
    await expect.element(field()).toHaveAttribute('placeholder', 'Choose a theme')
    await userEvent.keyboard('{Escape}')
    await expect.element(field()).toHaveAttribute('placeholder', 'Search or type a command')
    await userEvent.keyboard('{Escape}')
    await expect.element(field()).not.toBeInTheDocument()
  })

  it('switches team, keeping the section', async () => {
    api()
    const { router } = await show('/acme/web/triage', '/$workspace/$team/triage')
    await openMenu()
    await page.getByRole('option', { name: 'Switch team…' }).click()
    await userEvent.type(field(), 'doc')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/docs/triage'))
  })

  it('switches workspace, and picks a theme', async () => {
    api(empty, {
      'GET /api/workspaces/other/sidebar': { body: sidebarModel({ teams: [] }) },
      'GET /api/workspaces/other/search': { body: empty },
    })
    const { router } = await show()
    await openMenu()
    await page.getByRole('option', { name: 'Switch workspace…' }).click()
    await expect.element(page.getByRole('option', { name: /^Acme, Current/ })).toBeVisible()
    await page.getByRole('option', { name: /^Other/ }).click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await openMenu()
    await page.getByRole('option', { name: 'Theme…' }).click()
    await page.getByRole('option', { name: /^Light/ }).click()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset['circiColorScheme']).toBe('light'),
    )
    try {
      localStorage.removeItem('circi-color-mode')
    } catch {
      // Storage may be blocked; nothing to clean up then.
    }
  })
})

const hintsText = () =>
  page.getByRole('group', { name: 'Keyboard hints' }).element().textContent ?? ''

describe('the footer', () => {
  it('names what Enter does for the highlighted row', async () => {
    api()
    await show()
    await openMenu()
    // The first row is the page's own action: Enter runs it, and it has no new tab.
    await vi.waitFor(() => expect(hintsText()).toContain('↵ Run'))
    expect(hintsText()).not.toContain('New tab')
    await page.getByRole('option', { name: 'Inbox', exact: true }).hover()
    await vi.waitFor(() => expect(hintsText()).toContain('↵ Go to'))
    expect(hintsText()).toContain('⌘↵ New tab')
    await userEvent.type(field(), 'theme')
    await vi.waitFor(() => expect(hintsText()).toContain('↵ Choose'))
    await userEvent.clear(field())
    await userEvent.type(field(), 'sign')
    await vi.waitFor(() => expect(hintsText()).toContain('↵ Run'))
    expect(hintsText()).not.toContain('New tab')
  })

  it('shows ← Back, ↵ Choose and Esc back in a nested list', async () => {
    api()
    await show()
    await openMenu()
    await page.getByRole('option', { name: 'Theme…' }).click()
    await vi.waitFor(() => expect(hintsText()).toBe('← Back↵ ChooseEsc Back'))
  })
})

const token = (id: string) => ({ id, expiresAt: '2026-03-10T12:00:30.000Z' })
const decided = (undo: ReturnType<typeof token> | null) => ({
  build: {
    number: 148,
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'approved',
  },
  undo,
})

const buildAndTeam = (extra: Record<string, ReplyHandler> = {}) =>
  api(found({ builds: [build()] }), {
    'POST /api/teams/acme/web/builds/148/review': { body: decided(token('u1')) },
    'POST /api/teams/acme/web/builds/148/snapshots/review': { body: decided(token('u2')) },
    'POST /api/teams/acme/web/undo/u1': { body: { undone: true } },
    'POST /api/teams/acme/web/undo/u2': { body: { undone: true } },
    'GET /api/teams/acme/web/settings': { body: { settings: { requireRejectReason: false } } },
    ...extra,
  })

/** The build row's ⌘. list. */
async function openBuildActions() {
  await openMenu()
  await userEvent.type(field(), '148')
  await expect.element(page.getByRole('option', { name: /Build #148/ })).toBeVisible()
  await userEvent.keyboard('{Meta>}.{/Meta}')
  await expect.element(page.getByText('Actions', { exact: true })).toBeVisible()
}

const posts = (calls: { of: (m: string) => { path: string; body: unknown }[] }) =>
  calls.of('POST').map((c) => [c.path, c.body])

describe('row actions', () => {
  it('opens the highlighted row in a new tab with ⌘↵, and copies its link with ⌘⇧C', async () => {
    buildAndTeam()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const write = vi.spyOn(clipboard, 'write').mockResolvedValue()
    await show()
    await openMenu()
    await userEvent.type(field(), '148')
    await expect.element(page.getByRole('option', { name: /Build #148/ })).toBeVisible()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}/acme/web/builds/148`,
      '_blank',
      'noopener',
    )
    await openMenu()
    await userEvent.type(field(), '148')
    await expect.element(page.getByRole('option', { name: /Build #148/ })).toBeVisible()
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}')
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith(`${window.location.origin}/acme/web/builds/148`),
    )
    await expect.element(toast().getByText('Link copied')).toBeVisible()
  })

  it('sends Approve all at once, and Undo reverts it on the server', async () => {
    const calls = buildAndTeam()
    await show()
    await openBuildActions()
    for (const name of [
      'Approve all',
      'Reject',
      'Request review…',
      'Copy link',
      'Open in new tab',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(page.getByRole('option', { name })).toBeVisible()
    }
    await page.getByRole('option', { name: 'Approve all' }).click()
    await expect.element(toast().getByText('Approved build #148')).toBeVisible()
    await expect.element(field()).not.toBeInTheDocument()
    // Sent already: no waiting for the toast to run out.
    expect(posts(calls)).toEqual([['/api/teams/acme/web/builds/148/review', { state: 'approved' }]])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(toast().getByText('Undone')).toBeVisible()
    expect(posts(calls)).toEqual([
      ['/api/teams/acme/web/builds/148/review', { state: 'approved' }],
      ['/api/teams/acme/web/undo/u1', {}],
    ])
  })

  it('says why when the server refuses the undo (409)', async () => {
    buildAndTeam({
      'POST /api/teams/acme/web/undo/u1': {
        status: 409,
        body: { error: "Someone changed this review since, so it can't be undone" },
      },
    })
    await show()
    await openBuildActions()
    await page.getByRole('option', { name: 'Approve all' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect
      .element(toast().getByText("Someone changed this review since, so it can't be undone"))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('rejects the screenshots with no decision at once when no reason is required, with Undo', async () => {
    const calls = buildAndTeam()
    await show()
    await openBuildActions()
    await page.getByRole('option', { name: 'Reject', exact: true }).click()
    await expect.element(toast().getByText('Rejected build #148')).toBeVisible()
    expect(posts(calls)).toEqual([
      [
        '/api/teams/acme/web/builds/148/snapshots/review',
        { snapshotNames: 'undecided', decision: 'rejected' },
      ],
    ])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(toast().getByText('Undone')).toBeVisible()
    expect(calls.of('POST').at(-1)?.path).toBe('/api/teams/acme/web/undo/u2')
  })

  it('asks for the reason first when the team requires one, then rejects with it', async () => {
    const calls = buildAndTeam({
      'GET /api/teams/acme/web/settings': { body: { settings: { requireRejectReason: true } } },
    })
    await show()
    await openBuildActions()
    await page.getByRole('option', { name: 'Reject', exact: true }).click()
    await expect.element(field()).toHaveAttribute('placeholder', 'Why are you rejecting this?')
    await expect
      .element(page.getByRole('option', { name: 'Type a reason to reject' }))
      .toBeVisible()
    // Enter on the empty step sends nothing.
    await userEvent.keyboard('{Enter}')
    expect(calls.of('POST')).toEqual([])
    await userEvent.type(field(), '#nav is clipped')
    await userEvent.keyboard('{Enter}')
    await expect.element(toast().getByText('Rejected build #148')).toBeVisible()
    expect(posts(calls)).toEqual([
      [
        '/api/teams/acme/web/builds/148/snapshots/review',
        { snapshotNames: 'undecided', decision: 'rejected', reason: '#nav is clipped' },
      ],
    ])
  })

  it('runs the build page actions from the menu: Reject takes the screenshot in the address', async () => {
    const calls = buildAndTeam()
    await show('/acme/web/builds/148?shot=checkout%2Fsummary', '/$workspace/$team/builds/$number')
    await openMenu()
    await page.getByRole('option', { name: 'Reject screenshot' }).click()
    await expect.element(toast().getByText('Rejected checkout/summary')).toBeVisible()
    expect(posts(calls)).toEqual([
      [
        '/api/teams/acme/web/builds/148/snapshots/review',
        { snapshotNames: ['checkout/summary'], decision: 'rejected' },
      ],
    ])
  })

  describe('Request review', () => {
    const people = {
      members: [
        { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null },
        { id: 'u2', name: 'Dana Levi', email: 'dana@example.com', image: null },
        { id: 'u3', name: 'Lou Reed', email: 'lou@example.com', image: null },
        { id: 'u4', name: 'Ann Author', email: 'ann@example.com', image: null },
      ],
      canManage: true,
    }
    const setup = () =>
      buildAndTeam({
        'GET /api/teams/acme/web/members': { body: people },
        'GET /api/teams/acme/web/builds/148': {
          body: {
            build: { id: 'b-148', author: { login: 'ann', name: 'Ann Author' } },
            authorUserId: 'u4',
          },
        },
        'POST /api/teams/acme/web/builds/request-review': {
          body: { requests: [], undo: token('u3') },
        },
        'POST /api/teams/acme/web/undo/u3': { body: { undone: true } },
      })

    it('lists the team without you and the author, and asks one person at once, with Undo', async () => {
      const calls = setup()
      await show()
      await openBuildActions()
      await page.getByRole('option', { name: 'Request review…' }).click()
      await expect.element(field()).toHaveAttribute('placeholder', 'Find a person')
      await expect.element(page.getByRole('option', { name: /Dana Levi/ })).toBeVisible()
      await expect.element(page.getByRole('option', { name: /Lou Reed/ })).toBeVisible()
      await expect.element(page.getByRole('option', { name: /Ada/ })).not.toBeInTheDocument()
      await expect.element(page.getByRole('option', { name: /Ann Author/ })).not.toBeInTheDocument()
      await page.getByRole('option', { name: /Dana Levi/ }).click()
      await expect.element(toast().getByText('Asked Dana Levi to review build #148')).toBeVisible()
      expect(posts(calls)).toEqual([
        ['/api/teams/acme/web/builds/request-review', { buildIds: ['b-148'], reviewerIds: ['u2'] }],
      ])
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect.element(toast().getByText('Undone')).toBeVisible()
      expect(calls.of('POST').at(-1)?.path).toBe('/api/teams/acme/web/undo/u3')
    })

    it('picks several people with ⇧↵ and asks them together', async () => {
      const calls = setup()
      await show()
      await openBuildActions()
      await page.getByRole('option', { name: 'Request review…' }).click()
      await expect.element(page.getByRole('option', { name: /Dana Levi/ })).toBeVisible()
      await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
      await expect
        .element(page.getByRole('option', { name: 'Request review from Dana Levi' }))
        .toBeVisible()
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Shift>}{Enter}{/Shift}')
      await expect
        .element(page.getByRole('option', { name: 'Request review from 2 people' }))
        .toBeVisible()
      await page.getByRole('option', { name: 'Request review from 2 people' }).click()
      await expect.element(toast().getByText('Asked 2 people to review build #148')).toBeVisible()
      expect(posts(calls)).toEqual([
        [
          '/api/teams/acme/web/builds/request-review',
          { buildIds: ['b-148'], reviewerIds: ['u2', 'u3'] },
        ],
      ])
    })
  })

  it('assigns a triage item to you, snoozes it and marks a notice as read, each with Undo', async () => {
    const calls = api(more, {
      'POST /api/teams/acme/web/triage/assign': { body: { undo: token('t1') } },
      'POST /api/teams/acme/web/triage/snooze': { body: { undo: token('t2') } },
      'POST /api/teams/acme/web/undo/t1': { body: { undone: true } },
      'POST /api/inbox/n1/read': { body: { undo: token('n-u1') } },
      'POST /api/inbox/undo/n-u1': { body: { undone: true } },
    })
    await show()
    await openMenu()
    await userEvent.type(field(), 'summary')
    await page.getByRole('option', { name: /^Triage checkout\/summary/ }).hover()
    await userEvent.keyboard('{Meta>}.{/Meta}')
    await page.getByRole('option', { name: 'Assign to me' }).click()
    await expect.element(toast().getByText('Assigned to you')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(toast().getByText('Undone')).toBeVisible()
    await openMenu()
    await userEvent.type(field(), 'summary')
    await page.getByRole('option', { name: /^Triage checkout\/summary/ }).hover()
    await userEvent.keyboard('{Meta>}.{/Meta}')
    await page.getByRole('option', { name: 'Snooze until tomorrow' }).click()
    await expect.element(toast().getByText('Snoozed until tomorrow')).toBeVisible()
    await openMenu()
    await userEvent.type(field(), 'summary')
    await page.getByRole('option', { name: /^Inbox Ada mentioned you/ }).hover()
    await userEvent.keyboard('{Meta>}.{/Meta}')
    await page.getByRole('option', { name: 'Mark as read' }).click()
    await expect.element(toast().getByText('Marked as read')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(toast().getByText('Undone')).toBeVisible()
    expect(posts(calls)).toEqual([
      [
        '/api/teams/acme/web/triage/assign',
        { kind: 'flaky', key: 'checkout/summary', assigneeId: 'u1' },
      ],
      ['/api/teams/acme/web/undo/t1', {}],
      [
        '/api/teams/acme/web/triage/snooze',
        { kind: 'flaky', key: 'checkout/summary', choice: 'tomorrow' },
      ],
      ['/api/inbox/n1/read', { read: true }],
      ['/api/inbox/undo/n-u1', {}],
    ])
  })

  it('snoozes a review request, with Undo', async () => {
    const calls = api(more, {
      'POST /api/teams/acme/web/review-requests/r1/snooze': {
        body: { id: 'r1', snoozeKind: 'tomorrow', snoozedUntil: null, undo: token('s1') },
      },
      'POST /api/teams/acme/web/undo/s1': { body: { undone: true } },
    })
    await show()
    await openMenu()
    await userEvent.type(field(), 'summary')
    await page.getByRole('option', { name: /^Review request Review #148/ }).hover()
    await userEvent.keyboard('{Meta>}.{/Meta}')
    await page.getByRole('option', { name: 'Snooze until tomorrow' }).click()
    await expect.element(toast().getByText('Snoozed until tomorrow')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.element(toast().getByText('Undone')).toBeVisible()
    expect(posts(calls)).toEqual([
      ['/api/teams/acme/web/review-requests/r1/snooze', { kind: 'tomorrow' }],
      ['/api/teams/acme/web/undo/s1', {}],
    ])
  })
})

const inSettings = () =>
  renderPage(
    <ShortcutLayer>
      <Opener />
    </ShortcutLayer>,
    {
      announcer: true,
      viewport: [1200, 800],
      route: '/workspaces/$workspace/settings/members',
      url: '/workspaces/acme/settings/members',
      beforeRender: () => {
        useRecentStore.getState().record('acme', {
          kind: 'build',
          id: 'build:web:1',
          label: 'Build #1',
          path: '/acme/web/builds/1',
          at: Date.now(),
        })
      },
    },
  )

describe('settings is closed', () => {
  it('offers the frame sections and the way back, and nothing of the app', async () => {
    const calls = api(found({ builds: [build()] }))
    const { router } = await inSettings()
    await openMenu()
    await expect.element(page.getByRole('group', { name: 'In settings' })).toBeVisible()
    await expect.element(page.getByRole('group', { name: 'Leave settings' })).toBeVisible()
    await expect.element(page.getByRole('option', { name: /^Members/ })).toBeVisible()
    for (const gone of ['Recent', 'Needs you', 'Go to', 'Switch and change']) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(page.getByRole('group', { name: gone })).not.toBeInTheDocument()
    }
    await userEvent.type(field(), '148')
    await userEvent.clear(field())
    await userEvent.type(field(), 'check')
    await expect.element(page.getByRole('option', { name: /Build #148/ })).not.toBeInTheDocument()
    expect(calls.searches()).toEqual([])
    await userEvent.clear(field())
    await userEvent.type(field(), 'back')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/inbox'))
  })

  it('remembers the app page while you are on it, and leaves settings back to it', async () => {
    api()
    const { router } = await show('/acme/web/builds/148', '/$workspace/$team/builds/$number')
    await vi.waitFor(() =>
      expect(useSettingsReturnStore.getState().app).toBe('/acme/web/builds/148'),
    )
    // Entering settings keeps it: only app pages are remembered.
    router.history.push('/workspaces/acme/settings/members')
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/acme/settings/members'),
    )
    expect(useSettingsReturnStore.getState().app).toBe('/acme/web/builds/148')
  })

  it('names the page you came from in Leave settings, and goes there', async () => {
    api()
    const { router } = await renderPage(
      <ShortcutLayer>
        <Opener />
      </ShortcutLayer>,
      {
        announcer: true,
        viewport: [1200, 800],
        route: '/workspaces/$workspace/settings/members',
        url: '/workspaces/acme/settings/members',
        beforeRender: () => useSettingsReturnStore.getState().noteAppPage('/acme/web/builds/148'),
      },
    )
    await openMenu()
    await expect.element(page.getByRole('option', { name: /^Back to Build #148/ })).toBeVisible()
    await userEvent.type(field(), 'back')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acme/web/builds/148'))
  })

  it('opens the same section list from a section name typed in the app', async () => {
    api()
    await show()
    await openMenu()
    await userEvent.type(field(), 'members')
    await expect.element(page.getByRole('option', { name: /Settings · Members/ })).toBeVisible()
  })
})

describe('the command menu', () => {
  it('switches the theme from "theme" (the Appearance page points here)', async () => {
    api()
    await show()
    await openMenu()
    await userEvent.type(field(), 'theme')
    await expect.element(page.getByRole('option', { name: 'Theme…' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.element(field()).toHaveAttribute('placeholder', 'Choose a theme')
    await userEvent.type(field(), 'dark')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(document.documentElement.dataset['circiColorScheme']).toBe('dark'),
    )
    try {
      localStorage.removeItem('circi-color-mode')
    } catch {
      // Storage may be blocked; nothing to clean up then.
    }
  })

  it('closes with Esc and gives focus back to the button that opened it', async () => {
    api()
    await show()
    const opener = page.getByRole('button', { name: 'Search' })
    await opener.click()
    await expect.element(field()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(field()).not.toBeInTheDocument()
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
    for (const group of ['Navigation', 'General', 'Lists', 'Inbox']) {
      // eslint-disable-next-line no-await-in-loop -- one after another
      await expect.element(dialog.getByRole('region', { name: group })).toBeVisible()
    }
  })

  it('opens from "Keyboard shortcuts" in the command menu, by Enter and by click', async () => {
    api()
    await show()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await openMenu()
    await userEvent.type(field(), 'keyboard shortcuts')
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await openMenu()
    await page.getByRole('option', { name: /^Keyboard shortcuts/ }).click()
    await expect.element(dialog).toBeVisible()
  })
})
