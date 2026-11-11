import type { Search, View } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { type Chip, type Entry, verbOf } from '#features/command/entry.ts'
import {
  buildList,
  contextActions,
  contextScopes,
  flatten,
  footerHints,
  GROUP_CAP,
  type ListInput,
  type ListView,
  keyEvents,
  matchScore,
  type Needs,
  pageContext,
  parseBuildQuery,
  rememberedSearch,
  searchEntries,
  textScore,
  type TypedState,
  wrapIndex,
} from '#features/command/model.ts'
import { pageEntries, rowActionEntries, switchTeamPath } from '#features/command/pages.ts'
import {
  chipLabel,
  completeTeamToken,
  readTyped,
  withoutLastChip,
} from '#features/command/query.ts'
import { classifyVisit, shortAgo } from '#features/command/recent.ts'
import { changeWords, personPath, resultEntries } from '#features/command/results.ts'
import { settingsSections } from '#features/command/settings.ts'
import { sidebarTeam } from '#test/support/fixtures.ts'

const NOW = Date.parse('2026-03-10T12:00:00.000Z')

const teams = [
  sidebarTeam({ slug: 'web', name: 'Web App', pinned: true }),
  sidebarTeam({ slug: 'docs', name: 'Docs' }),
  sidebarTeam({ slug: 'mobile', name: 'Mobile' }),
]
const views: View.Item[] = [
  {
    id: 'v1',
    name: 'Checkout regressions',
    filters: {},
    pinned: true,
    position: 0,
    team: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
]

const build = (over: Partial<Search.Build> = {}): Search.Build => ({
  teamSlug: 'web',
  teamName: 'Web App',
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

const results = (over: Partial<Search.Results> = {}): Search.Results => ({
  query: 'x',
  builds: [],
  branches: [],
  teams: [],
  snapshots: [],
  baselines: [],
  triage: [],
  notifications: [],
  reviews: [],
  views: [],
  people: [],
  totals: {
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
  },
  ...over,
})

const input = (over: Partial<ListInput> = {}): ListInput => ({
  workspace: 'acme',
  pathname: '/inbox',
  routeWorkspace: undefined,
  teams,
  views,
  workspaces: [
    { slug: 'acme', name: 'Acme' },
    { slug: 'other', name: 'Other' },
  ],
  canManage: true,
  instanceAdmin: false,
  inSettings: false,
  needs: { reviews: 0, unread: 0, triageAssigned: 0 },
  recents: [],
  now: NOW,
  ...over,
})

const typed = (over: Partial<TypedState> = {}): TypedState => ({
  query: '',
  chips: [],
  contextCleared: false,
  results: undefined,
  pending: false,
  failed: false,
  ...over,
})

const labels = (view: ListView): string[] => flatten(view.groups).map((e) => e.label)
const headings = (view: ListView): string[] => view.groups.map((g) => g.label)

const headingOn = (pathname: string) =>
  headings(buildList(input({ pathname, routeWorkspace: 'acme' }), typed()))[0]

const needRows = (needs: Needs) =>
  buildList(input({ needs }), typed()).groups.find((g) => g.label === 'Needs you')?.entries

const actionLabelsOn = (path: string) => contextActions(path).map((e) => e.label)

const entryOf = (over: Partial<Entry>): Entry => ({
  id: 'x',
  group: 'g',
  kind: 'build',
  label: 'x',
  icon: 'status',
  target: { type: 'path', path: '/acme/web/builds/148' },
  path: '/acme/web/builds/148',
  peek: { kind: 'Build', title: 'x', lines: [], rows: [] },
  ...over,
})

const insideSettings = (query: string, pathname = '/workspaces/acme/settings/members') =>
  buildList(
    input({
      pathname,
      inSettings: true,
      recents: [{ kind: 'build', id: 'b', label: 'Build #1', path: '/x', at: NOW }],
    }),
    typed({ query, results: results({ builds: [build()] }) }),
  )

const footerEntry = (kind: Entry['kind'], path?: string): Entry => ({
  id: 'x',
  group: 'g',
  kind,
  label: 'x',
  icon: 'inbox',
  target: { type: 'path', path: '/' },
  ...(path ? { path } : {}),
  peek: { kind: 'x', title: 'x', lines: [], rows: [] },
})
const hintText = (h: ReturnType<typeof footerHints>) =>
  h.map((x) => `${x.keys.join(' ')} ${x.label}`)

const visitAt = (p: string, search = '') => classifyVisit(p, search, teams, views, NOW)

describe('parseBuildQuery', () => {
  it('reads #148 and 148 as build 148', () => {
    expect(parseBuildQuery('#148')).toBe(148)
    expect(parseBuildQuery(' 148 ')).toBe(148)
    expect(parseBuildQuery('# 148')).toBe(148)
  })
  it('leaves everything else to the search', () => {
    expect(parseBuildQuery('')).toBeUndefined()
    expect(parseBuildQuery('main')).toBeUndefined()
    expect(parseBuildQuery('#14a')).toBeUndefined()
    expect(parseBuildQuery('1234567890')).toBeUndefined()
  })
})

describe('wrapIndex', () => {
  it('wraps at both ends', () => {
    expect(wrapIndex(3, 2, 1)).toBe(0)
    expect(wrapIndex(3, 0, -1)).toBe(2)
  })
  it('starts at an end when nothing is highlighted, and is -1 for an empty list', () => {
    expect(wrapIndex(3, -1, 1)).toBe(0)
    expect(wrapIndex(3, -1, -1)).toBe(2)
    expect(wrapIndex(0, -1, 1)).toBe(-1)
  })
})

const changeRows = (view: ListView) =>
  view.groups.find((g) => g.label === 'Switch and change')?.entries

const person = (n: number) => ({
  id: `u${n}`,
  name: `Dana ${n}`,
  email: `d${n}@acme.test`,
  image: null,
  teams: [],
  openReviews: 0,
})

describe('the empty query', () => {
  it('lists pages as plain nouns under Go to, never "Open …"', () => {
    const view = buildList(input(), typed())
    const goTo = view.groups.find((g) => g.label === 'Go to')
    expect(goTo?.entries.map((e) => e.label)).toEqual([
      'Inbox',
      'Reviews',
      'Triage',
      'Teams',
      'Insights',
      'Settings',
      'Web App',
      'Checkout regressions',
    ])
    expect(labels(view).some((l) => l.startsWith('Open '))).toBe(false)
    expect(goTo?.entries.find((e) => e.label === 'Inbox')?.hint).toBe('g i')
    expect(goTo?.entries.find((e) => e.label === 'Web App')?.kindLabel).toBe('Team')
    expect(goTo?.entries.find((e) => e.label === 'Checkout regressions')?.kindLabel).toBe(
      'Saved view',
    )
  })

  it('gives items a kind label and actions none', () => {
    const view = buildList(input({ pathname: '/acme/web/builds/148' }), typed())
    const plain = flatten(view.groups).filter((e) => e.kind === 'action' || e.kind === 'page')
    expect(plain.length).toBeGreaterThan(5)
    expect(plain.filter((e) => e.kindLabel !== undefined)).toEqual([])
    const items = flatten(view.groups).filter((e) => e.kind === 'team' || e.kind === 'view')
    expect(items.filter((e) => e.kindLabel === undefined)).toEqual([])
  })

  it('orders the groups: the page, Recent, Needs you, Go to, Switch and change', () => {
    const view = buildList(
      input({
        pathname: '/acme/web/builds/148',
        routeWorkspace: 'acme',
        needs: { reviews: 3, unread: 1, triageAssigned: 2 },
        recents: [
          {
            kind: 'build',
            id: 'build:web:140',
            label: 'Build #140',
            detail: 'Web App',
            path: '/acme/web/builds/140',
            at: NOW - 2 * 3_600_000,
          },
        ],
      }),
      typed(),
    )
    expect(headings(view)).toEqual([
      'Build #148',
      'Recent',
      'Needs you',
      'Go to',
      'Switch and change',
    ])
  })

  it('names the page in the heading of its actions', () => {
    expect(headingOn('/workspaces/acme/reviews')).toBe('Reviews')
    expect(headingOn('/inbox')).toBe('Inbox')
    expect(headingOn('/acme/web/triage')).toBe('Triage')
    expect(headingOn('/acme/web/baselines/checkout/payment')).toBe('Baseline: checkout / payment')
    expect(headingOn('/acme/web')).toBe('Builds')
  })

  it('shows Needs you with counts, singular and plural, and drops a zero', () => {
    expect(needRows({ reviews: 3, unread: 1, triageAssigned: 2 })?.map((e) => e.label)).toEqual([
      '3 reviews waiting on you',
      '2 triage items assigned to you',
      '1 unread notice',
    ])
    expect(needRows({ reviews: 1, unread: 0, triageAssigned: 0 })?.map((e) => e.label)).toEqual([
      '1 review waiting on you',
    ])
    expect(needRows({ reviews: 0, unread: 0, triageAssigned: 0 })).toBeUndefined()
  })

  it('lists Recent newest first without the current page, five at most, with relative times', () => {
    const recents = Array.from({ length: 8 }, (_, i) => ({
      kind: 'build' as const,
      id: `build:web:${i}`,
      label: `Build #${i}`,
      path: `/acme/web/builds/${i}`,
      at: NOW - i * 3_600_000,
    }))
    const view = buildList(input({ pathname: '/acme/web/builds/0', recents }), typed())
    const recent = view.groups.find((g) => g.label === 'Recent')?.entries
    expect(recent?.map((e) => e.label)).toEqual([
      'Build #1',
      'Build #2',
      'Build #3',
      'Build #4',
      'Build #5',
    ])
    expect(recent?.[0]?.time).toBe('1 h ago')
    expect(recent?.[0]?.kindLabel).toBe('Build')
  })

  it('has no Recent on a first open, and Go to leads', () => {
    expect(headings(buildList(input(), typed()))[0]).toBe('Inbox')
    expect(headings(buildList(input({ pathname: '/account/profile' }), typed()))).not.toContain(
      'Recent',
    )
  })

  it('lists Switch team…, Switch workspace… and Theme… with a chevron, then Keyboard shortcuts and Sign out', () => {
    const view = buildList(input(), typed())
    const rows = view.groups.find((g) => g.label === 'Switch and change')?.entries
    expect(rows?.map((e) => e.label)).toEqual([
      'Switch team…',
      'Switch workspace…',
      'New team',
      'Invite people',
      'Theme…',
      'Keyboard shortcuts',
      'Sign out',
    ])
    expect(rows?.filter((e) => e.chevron).map((e) => e.label)).toEqual([
      'Switch team…',
      'Switch workspace…',
      'Theme…',
    ])
    expect(rows?.find((e) => e.label === 'Keyboard shortcuts')?.hint).toBe('?')
  })

  it('offers New team and Invite people to who may manage the workspace, and New workspace to who may create one', () => {
    const viewer = changeRows(buildList(input({ canManage: false }), typed()))?.map((e) => e.label)
    expect(viewer).not.toContain('New team')
    expect(viewer).not.toContain('Invite people')
    const manager = changeRows(buildList(input(), typed()))?.map((e) => e.label)
    expect(manager).not.toContain('New workspace')
    const all = changeRows(buildList(input({ canCreateWorkspace: true }), typed()))
    expect(all?.map((e) => e.label)).toContain('New workspace')
    expect(all?.find((e) => e.label === 'New team')?.target).toEqual({
      type: 'create',
      what: 'team',
    })
    expect(all?.find((e) => e.label === 'New workspace')?.target).toEqual({
      type: 'create',
      what: 'workspace',
    })
    // Invite people is an entry point to Members, the one settings page the menu may send to.
    expect(all?.find((e) => e.label === 'Invite people')).toMatchObject({
      target: { type: 'path', path: '/workspaces/acme/settings/members' },
      path: '/workspaces/acme/settings/members',
    })
  })

  it('finds the Create entries by typing, and offers none inside settings', () => {
    expect(labels(buildList(input(), typed({ query: 'invite' })))).toContain('Invite people')
    expect(labels(buildList(input(), typed({ query: 'new te' })))).toContain('New team')
    const inside = buildList(
      input({ pathname: '/workspaces/acme/settings/members', inSettings: true }),
      typed({ query: 'new team' }),
    )
    expect(labels(inside)).not.toContain('New team')
  })

  it('lists recent searches under Recent when the field is empty, with a row that clears them', () => {
    const view = buildList(input({ searches: ['checkout', '#148'] }), typed())
    const recent = view.groups.find((g) => g.label === 'Recent')?.entries
    expect(recent?.map((e) => e.label)).toEqual(['checkout', '#148', 'Clear recent searches'])
    expect(recent?.[0]).toMatchObject({
      kind: 'search',
      kindLabel: 'Search',
      target: { type: 'search', text: 'checkout' },
    })
    expect(recent?.[2]?.target).toEqual({ type: 'clearSearches' })
    expect(verbOf(recent?.[0])).toBe('Choose')
    expect(searchEntries([])).toEqual([])
    // Typing hides them, and so does a kind chip.
    expect(
      labels(buildList(input({ searches: ['checkout'] }), typed({ query: 'zz' }))),
    ).not.toContain('Clear recent searches')
  })

  it('remembers what was typed only for a result, with the prefix of its kind chip', () => {
    const chips: Chip[] = [{ type: 'kind', kind: 'people' }]
    expect(rememberedSearch({ id: 'person:u1', kind: 'person' }, chips, ' dana ')).toBe('@dana')
    expect(rememberedSearch({ id: 'build:web:1', kind: 'build' }, [], 'checkout')).toBe('checkout')
    expect(rememberedSearch({ id: 'build:web:1', kind: 'build' }, [], 'c')).toBeUndefined()
    expect(rememberedSearch({ id: 'switch:theme', kind: 'submenu' }, [], 'theme')).toBeUndefined()
    expect(
      rememberedSearch({ id: 'recent:build:web:1', kind: 'build' }, [], 'check'),
    ).toBeUndefined()
  })

  it('leaves out Switch workspace… when there is only one', () => {
    const view = buildList(input({ workspaces: [{ slug: 'acme', name: 'Acme' }] }), typed())
    expect(labels(view)).not.toContain('Switch workspace…')
  })
})

describe('page actions', () => {
  it('uses the menu verbs, with the registry keys, for a build', () => {
    const rows = contextActions('/acme/web/builds/148', pageContext('/acme/web/builds/148', teams))
    const byLabel = Object.fromEntries(rows.map((e) => [e.label, e.hint]))
    expect(byLabel['Approve screenshot']).toBe('a')
    expect(byLabel['Approve all']).toBe('shift+a')
    expect(byLabel['Reject screenshot']).toBe('r')
    expect(byLabel['Request review']).toBe('shift+r')
    expect(byLabel['Write a comment']).toBe('c')
    expect(byLabel['Copy link to this page']).toBe('mod+shift+c')
  })

  it('says what it will do and to what in the peek', () => {
    const page = pageContext('/acme/web/builds/148', teams)
    const approveAll = contextActions('/acme/web/builds/148', page, 7).find(
      (e) => e.label === 'Approve all',
    )
    expect(approveAll?.peek.lines).toEqual(['Approves all 7 changed screenshots in build #148.'])
  })

  it('offers no action that nothing on the page would handle', () => {
    expect(actionLabelsOn('/acme/web')).not.toContain('Snooze…')
    expect(actionLabelsOn('/inbox')).toContain('Snooze…')
    expect(actionLabelsOn('/inbox')).toContain('Mark as read')
  })

  it('maps pages to the shortcut scopes', () => {
    expect(contextScopes('/acme/web/builds/148')).toEqual(['build-review'])
    expect(contextScopes('/inbox')).toEqual(['inbox', 'list'])
    expect(contextScopes('/account/profile')).toEqual([])
  })
})

describe('the context of a page', () => {
  it('names the team and build on a build, and the team on its other pages', () => {
    expect(pageContext('/acme/web/builds/148', teams, 'acme', 'acme')).toMatchObject({
      chip: 'Web App · #148',
      heading: 'Build #148',
      team: { slug: 'web', name: 'Web App' },
    })
    expect(pageContext('/acme/docs/triage', teams, 'acme', 'acme').chip).toBe('Docs')
  })
  it('has no chip off a team, or on a team of another workspace', () => {
    expect(pageContext('/inbox', teams).chip).toBeUndefined()
    expect(pageContext('/workspaces/acme/reviews', teams).chip).toBeUndefined()
    expect(pageContext('/other/web', teams, 'other', 'acme').team).toBeUndefined()
  })
})

describe('matching and ranking', () => {
  it('scores equal, prefix, word start and substring in that order', () => {
    expect(textScore('Inbox', 'inbox')).toBe(100)
    expect(textScore('Inbox zero', 'inbox')).toBe(80)
    expect(textScore('Go to inbox', 'inbox')).toBe(60)
    expect(textScore('Checkbox', 'box')).toBe(40)
    expect(textScore('Inbox', 'zzz')).toBe(0)
  })

  it('matches on aliases (prefs, dark, approve) and needs every word', () => {
    const theme = { label: 'Theme…', keywords: ['prefs', 'dark'] }
    expect(matchScore(theme, ['dark'])).toBeGreaterThan(0)
    expect(matchScore(theme, ['prefs', 'theme'])).toBeGreaterThan(0)
    expect(matchScore(theme, ['dark', 'nope'])).toBe(0)
  })

  it('puts a prefix match above a substring match', () => {
    const view = buildList(input(), typed({ query: 'in' }))
    const goTo = view.groups.find((g) => g.label === 'Go to')?.entries.map((e) => e.label)
    expect(goTo?.[0]).toBe('Inbox')
  })
})

describe('a typed query', () => {
  const found = results({
    builds: [build(), build({ number: 147, name: 'Cart' }), build({ number: 146, name: 'Nav' })],
    branches: [
      { teamSlug: 'web', teamName: 'Web App', branch: 'feat/checkout', latestBuildNumber: 148 },
    ],
    snapshots: [
      {
        teamSlug: 'web',
        teamName: 'Web App',
        name: 'Checkout / Payment',
        latestBuildNumber: 148,
        thumbnail: null,
      },
    ],
    totals: { ...results().totals, builds: 12, branches: 1, snapshots: 1 },
  })

  it('leads with the group of the best matches, breaking ties by the spec order, each row with its kind', () => {
    const view = buildList(input(), typed({ query: 'check', results: found }))
    const names = headings(view).filter(Boolean)
    // Go to (the saved view) and Screenshots both match at the start of the name: Go to is first of the tie.
    expect(names.slice(0, 2)).toEqual(['Go to', 'Screenshots'])
    // Builds and Branches match at a word start: the spec lists Builds first.
    expect(names.indexOf('Builds')).toBeLessThan(names.indexOf('Branches'))
    expect(names.indexOf('Screenshots')).toBeLessThan(names.indexOf('Builds'))
    const kinds = flatten(view.groups)
      .filter((e) => e.kindLabel)
      .map((e) => `${e.kind}:${e.kindLabel}`)
    expect(kinds).toContain('build:Build')
    expect(kinds).toContain('branch:Branch')
    expect(kinds).toContain('screenshot:Screenshot')
  })

  it('caps a result group at 3 with a "Show all 12 builds" row that applies the chip', () => {
    const view = buildList(input(), typed({ query: 'check', results: found }))
    const builds = view.groups.find((g) => g.label === 'Builds')?.entries ?? []
    expect(builds).toHaveLength(GROUP_CAP + 1)
    const more = builds.at(-1)
    expect(more?.label).toBe('Show all 12 builds')
    expect(more?.target).toEqual({ type: 'chip', chip: { type: 'kind', kind: 'builds' } })
  })

  it('has no cap and no "Show all" once a kind chip narrows it', () => {
    const chips: Chip[] = [{ type: 'kind', kind: 'builds' }]
    const view = buildList(input(), typed({ query: 'check', chips, results: found }))
    expect(labels(view)).not.toContain('Show all 12 builds')
    expect(view.groups.flatMap((g) => g.entries).filter((e) => e.kind === 'build')).toHaveLength(3)
  })

  it('leads with a single best match, with no heading, when one hit is clearly first', () => {
    const view = buildList(
      input({ pathname: '/acme/web/builds/9', routeWorkspace: 'acme' }),
      typed({ query: '#148', results: found }),
    )
    expect(view.groups[0]?.label).toBe('')
    expect(view.groups[0]?.entries).toHaveLength(1)
    expect(view.groups[0]?.entries[0]?.id).toBe('build:web:148')
    // It is not listed a second time under Builds.
    const builds = view.groups.find((g) => g.label === 'Builds')?.entries.map((e) => e.id)
    expect(builds).not.toContain('build:web:148')
  })

  it('jumps to the build number in the open team before the answer arrives', () => {
    const view = buildList(
      input({ pathname: '/acme/web', routeWorkspace: 'acme' }),
      typed({ query: '148' }),
    )
    expect(view.groups[0]?.entries[0]).toMatchObject({
      label: 'Build #148',
      target: { type: 'path', path: '/acme/web/builds/148' },
    })
  })

  it('shows no best match when two hits tie', () => {
    const view = buildList(input(), typed({ query: 'in' }))
    expect(view.groups[0]?.label).not.toBe('')
  })

  it('shows each saved view once, though a view is a menu entry and a result', () => {
    const view = buildList(
      input(),
      typed({
        query: 'checkout',
        results: results({
          views: [{ id: 'v1', name: 'Checkout regressions', team: null }],
        }),
      }),
    )
    expect(labels(view).filter((l) => l === 'Checkout regressions')).toHaveLength(1)
  })

  it('renders the new kinds with their icon and kind label', () => {
    const rows = resultEntries(
      { workspace: 'acme', teams, allTeams: true },
      results({
        baselines: [
          {
            teamSlug: 'web',
            teamName: 'Web App',
            name: 'checkout/summary',
            buildNumber: 140,
            thumbnail: null,
            approvedBy: null,
          },
        ],
        triage: [
          {
            teamSlug: 'web',
            teamName: 'Web App',
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
            team: { slug: 'web', name: 'Web App' },
            payload: { snippet: 'cut off' },
          },
        ],
        reviews: [
          {
            id: 'r1',
            tab: 'for-you',
            teamSlug: 'web',
            teamName: 'Web App',
            build: { number: 148, name: 'default', branch: 'main' },
            reviewer: { name: 'Me' },
            requestedBy: { name: 'Dana Levi' },
            createdAt: '2026-03-10T12:00:00.000Z',
          },
        ],
      }),
    )
    const byKind = Object.fromEntries(rows.map((e) => [e.kind, e]))
    expect(byKind['baseline']).toMatchObject({ icon: 'layers', kindLabel: 'Baseline' })
    expect(byKind['triage']).toMatchObject({
      icon: 'alert',
      kindLabel: 'Triage',
      detail: 'Flaky on main · Web App',
    })
    expect(byKind['notice']).toMatchObject({ icon: 'bell', kindLabel: 'Inbox', unread: true })
    expect(byKind['review']).toMatchObject({
      label: 'Review #148',
      detail: 'from Dana Levi · Web App',
      icon: 'eye',
      kindLabel: 'Review request',
    })
    expect(byKind['triage']?.target).toEqual({
      type: 'path',
      path: '/acme/web/triage?item=flaky%3Acheckout%2Fsummary',
    })
  })
})

describe('scope', () => {
  const onWeb = { pathname: '/acme/web/builds/9', routeWorkspace: 'acme' }

  it('limits a team page to its team and ends the list with a "Search all teams" row', () => {
    const view = buildList(input(onWeb), typed({ query: 'checkout', results: results() }))
    expect(view.scope).toEqual({ slug: 'web', name: 'Web App' })
    const last = flatten(view.groups).at(-1)
    expect(last).toMatchObject({
      kind: 'widen',
      label: 'Search all teams for "checkout"',
      hint: 'mod+Enter',
    })
  })

  it('is workspace-wide, with no widen row, off a team page', () => {
    const view = buildList(input(), typed({ query: 'checkout', results: results() }))
    expect(view.scope).toBeUndefined()
    expect(flatten(view.groups).some((e) => e.kind === 'widen')).toBe(false)
  })

  it('is widened by removing the page chip, or limited to a team by a team chip', () => {
    const widened = buildList(input(onWeb), typed({ query: 'x', contextCleared: true }))
    expect(widened.scope).toBeUndefined()
    const chip: Chip = { type: 'team', slug: 'docs', name: 'Docs' }
    const limited = buildList(input(), typed({ query: 'x', chips: [chip] }))
    expect(limited.scope).toEqual({ slug: 'docs', name: 'Docs' })
  })

  it('says what was not found and offers three ways on, with the build number tip only without a digit', () => {
    const view = buildList(input(onWeb), typed({ query: 'chekout', results: results() }))
    expect(view.state).toBe('none')
    expect(view.message).toBe('No results for "chekout" in Web App.')
    expect(view.tip).toBe('Try a build number like #148.')
    expect(labels(view)).toEqual([
      'Search all teams for "chekout"',
      'Show all builds',
      'Show all pages',
    ])
    const withDigit = buildList(input(), typed({ query: 'x9', results: results() }))
    expect(withDigit.tip).toBeUndefined()
    expect(withDigit.message).toBe('No results for "x9".')
  })

  it('shows Searching while the answer is on its way, and a retry row when it failed', () => {
    const waiting = buildList(input(), typed({ query: 'chec', pending: true }))
    expect(waiting.state).toBe('searching')
    const failed = buildList(input(), typed({ query: 'chec', failed: true }))
    expect(failed.state).toBe('error')
    expect(failed.message).toBe("Couldn't search. Check your connection and try again.")
    expect(labels(failed).at(-1)).toBe('Try again')
  })
})

describe('prefixes and chips', () => {
  it('turns a first # / > / character into a kind chip', () => {
    expect(readTyped('#14', [], teams)).toEqual({
      chips: [{ type: 'kind', kind: 'builds' }],
      text: '14',
    })
    expect(readTyped('>theme', [], teams).chips).toEqual([{ type: 'kind', kind: 'commands' }])
    expect(readTyped('/checkout', [], teams).chips).toEqual([{ type: 'kind', kind: 'screenshots' }])
    // A second prefix is just text, and a prefix after text stays text.
    expect(readTyped('#a#b', [], teams).text).toBe('a#b')
    expect(readTyped('a#b', [], teams).chips).toEqual([])
  })

  it('reads @ as the people chip', () => {
    expect(readTyped('@dana', [], teams)).toEqual({
      chips: [{ type: 'kind', kind: 'people' }],
      text: 'dana',
    })
  })

  it('turns "in:name " and "team:slug " into a team chip, and keeps the rest', () => {
    expect(readTyped('in:docs checkout', [], teams)).toEqual({
      chips: [{ type: 'team', slug: 'docs', name: 'Docs' }],
      text: 'checkout',
    })
    expect(readTyped('in:docs', [], teams).chips).toEqual([])
    expect(readTyped('checkout in:docs ', [], teams)).toEqual({
      chips: [{ type: 'team', slug: 'docs', name: 'Docs' }],
      text: 'checkout',
    })
    // A slug or a one-word name, in any case.
    expect(readTyped('team:WEB app', [], teams)).toEqual({
      chips: [{ type: 'team', slug: 'web', name: 'Web App' }],
      text: 'app',
    })
    expect(readTyped('in:nope ', [], teams).chips).toEqual([])
  })

  it('completes a half-typed team with Tab', () => {
    expect(completeTeamToken('in:mo', [], teams)).toEqual({
      chips: [{ type: 'team', slug: 'mobile', name: 'Mobile' }],
      text: '',
    })
    expect(completeTeamToken('x in:do', [], teams)?.text).toBe('x')
    expect(completeTeamToken('in:zz', [], teams)).toBeUndefined()
    expect(completeTeamToken('plain', [], teams)).toBeUndefined()
  })

  it('removes the kind chip before the team chip on Backspace', () => {
    const chips: Chip[] = [
      { type: 'team', slug: 'docs', name: 'Docs' },
      { type: 'kind', kind: 'builds' },
    ]
    expect(withoutLastChip(chips)).toEqual([{ type: 'team', slug: 'docs', name: 'Docs' }])
    expect(chips.map(chipLabel)).toEqual(['Docs', 'Builds'])
  })

  it('runs commands only for >, and asks the search only for the chip kinds', () => {
    const commands = buildList(
      input(),
      typed({ query: 'theme', chips: [{ type: 'kind', kind: 'commands' }], results: results() }),
    )
    expect(commands.kinds).toEqual([])
    expect(labels(commands)).toContain('Theme…')
    const screenshots = buildList(
      input(),
      typed({ query: 'x', chips: [{ type: 'kind', kind: 'screenshots' }] }),
    )
    expect(screenshots.kinds).toEqual(['snapshots', 'baselines'])
    expect(labels(screenshots)).not.toContain('Inbox')
  })

  it('lists recent builds under a # chip with an empty field', () => {
    const view = buildList(
      input({
        recents: [
          { kind: 'build', id: 'b', label: 'Build #1', path: '/acme/web/builds/1', at: NOW },
          { kind: 'team', id: 't', label: 'Web App', path: '/acme/web', at: NOW },
        ],
      }),
      typed({ chips: [{ type: 'kind', kind: 'builds' }] }),
    )
    expect(labels(view)).toEqual(['Build #1'])
  })
})

describe('nested lists', () => {
  const nested = {
    workspace: 'acme',
    pathname: '/acme/web/triage',
    teams,
    workspaces: [
      { slug: 'acme', name: 'Acme' },
      { slug: 'other', name: 'Other' },
    ],
    routeTeam: 'web',
    theme: 'system' as const,
  }

  it('lists the teams with the current one checked, and keeps the section on a switch', () => {
    const rows = pageEntries({ page: 'team' }, nested, '')
    expect(rows.map((e) => e.label)).toEqual(['Web App', 'Docs', 'Mobile'])
    expect(rows.find((e) => e.checked)?.label).toBe('Web App')
    expect(rows.find((e) => e.label === 'Docs')?.path).toBe('/acme/docs/triage')
    expect(switchTeamPath('/acme/web/builds/148', 'acme', 'docs')).toBe('/acme/docs')
    expect(switchTeamPath('/inbox', 'acme', 'docs')).toBe('/acme/docs')
    expect(switchTeamPath('/acme/web/baselines/a/b', 'acme', 'docs')).toBe('/acme/docs/baselines')
  })

  it('filters a list by what is typed', () => {
    expect(pageEntries({ page: 'team' }, nested, 'mo').map((e) => e.label)).toEqual(['Mobile'])
    expect(pageEntries({ page: 'team' }, nested, 'zzz')).toEqual([])
  })

  it('lists the workspaces and the three themes, the current one marked', () => {
    expect(pageEntries({ page: 'workspace' }, nested, '').find((e) => e.checked)?.label).toBe(
      'Acme',
    )
    const themes = pageEntries({ page: 'theme' }, { ...nested, theme: 'dark' }, '')
    expect(themes.map((e) => e.label)).toEqual(['System', 'Light', 'Dark'])
    expect(themes.find((e) => e.checked)).toMatchObject({ label: 'Dark', detail: 'Current' })
  })
})

describe('the people list of Request review', () => {
  const nested = {
    workspace: 'acme',
    pathname: '/acme/web/builds/148',
    teams,
    workspaces: [],
    routeTeam: 'web',
    theme: 'system' as const,
    members: [
      { id: 'u1', name: 'Me' },
      { id: 'u2', name: 'Dana Levi' },
      { id: 'u3', name: 'Dana Levi' },
      { id: 'u4', name: 'Grace Hopper' },
    ],
    meId: 'u1',
  }
  const subject = {
    type: 'build' as const,
    workspace: 'acme',
    team: 'web',
    number: 148,
    label: 'build #148',
  }

  it("leaves out you and the build's author by user ID, not by name", () => {
    const rows = pageEntries({ page: 'reviewers', subject }, { ...nested, authorId: 'u2' }, '')
    // Two people are called Dana Levi: only the author (u2) is left out.
    expect(rows.map((e) => e.id)).toEqual(['reviewer:u3', 'reviewer:u4'])
    expect(
      pageEntries({ page: 'reviewers', subject }, { ...nested, authorId: null }, ''),
    ).toHaveLength(3)
  })

  it('says Choose for Request review…, which opens a list', () => {
    const rows = rowActionEntries(entryOf({ subject }))
    const ask = rows.find((e) => e.label === 'Request review…')
    expect(ask?.chevron).toBe(true)
    expect(verbOf(ask)).toBe('Choose')
    expect(verbOf(rows.find((e) => e.label === 'Reject'))).toBe('Run')
  })
})

describe('search results with peeks', () => {
  const ctx = { workspace: 'acme', teams, allTeams: true, now: NOW }

  it('shows a build its change counts and its largest change as a thumbnail', () => {
    const [row] = resultEntries(
      ctx,
      results({
        builds: [
          build({ changes: { changed: 3, added: 1, removed: 0 }, thumbnail: 'ab'.repeat(32) }),
        ],
      }),
    )
    expect(row?.peek.thumb).toBe('ab'.repeat(32))
    expect(row?.peek.rows).toContainEqual({ label: 'Changes', value: '3 changed, 1 added' })
    expect(changeWords({ changed: 0, added: 0, removed: 0 })).toBe('')
    const [plain] = resultEntries(ctx, results({ builds: [build()] }))
    expect(plain?.peek.thumb).toBeUndefined()
    expect(plain?.peek.rows.map((r) => r.label)).not.toContain('Changes')
  })

  it('gives screenshots and baselines a thumbnail, and baselines their approver', () => {
    const rows = resultEntries(
      ctx,
      results({
        snapshots: [
          {
            teamSlug: 'web',
            teamName: 'Web App',
            name: 'home',
            latestBuildNumber: 3,
            thumbnail: 'cd'.repeat(32),
          },
        ],
        baselines: [
          {
            teamSlug: 'web',
            teamName: 'Web App',
            name: 'home',
            buildNumber: 2,
            thumbnail: 'ef'.repeat(32),
            approvedBy: 'Dana Levi',
          },
        ],
      }),
    )
    expect(rows[0]?.peek.thumb).toBe('cd'.repeat(32))
    expect(rows[1]?.peek.thumb).toBe('ef'.repeat(32))
    expect(rows[1]?.peek.rows).toContainEqual({ label: 'Approved by', value: 'Dana Levi' })
  })

  it('names the assignee of a triage item and the age of a review request', () => {
    const rows = resultEntries(
      ctx,
      results({
        triage: [
          {
            teamSlug: 'web',
            teamName: 'Web App',
            kind: 'flaky',
            key: 'home',
            snapshotName: 'home',
            buildNumber: 9,
            branch: 'main',
            assignee: { name: 'Grace Hopper' },
          },
        ],
        reviews: [
          {
            id: 'r1',
            tab: 'for-you',
            teamSlug: 'web',
            teamName: 'Web App',
            build: { number: 9, name: 'default', branch: 'main' },
            reviewer: { name: 'Me' },
            requestedBy: null,
            createdAt: new Date(NOW - 3 * 3600_000).toISOString(),
          },
        ],
      }),
    )
    expect(rows[0]?.peek.lines).toEqual(['Flaky on main.'])
    expect(rows[0]?.peek.rows).toContainEqual({ label: 'Assignee', value: 'Grace Hopper' })
    expect(rows[1]?.peek.rows).toContainEqual({ label: 'Asked', value: '3 h ago' })
  })

  it('lists people with their avatar, teams and open reviews, opening their review requests', () => {
    const [row] = resultEntries(
      ctx,
      results({
        people: [
          {
            id: 'u2',
            name: 'Dana Levi',
            email: 'dana@acme.test',
            image: null,
            teams: [
              { slug: 'web', name: 'Web App' },
              { slug: 'docs', name: 'Docs' },
            ],
            openReviews: 2,
          },
        ],
      }),
    )
    expect(row).toMatchObject({
      group: 'People',
      kind: 'person',
      label: 'Dana Levi',
      detail: 'dana@acme.test',
      kindLabel: 'Person',
      avatar: { id: 'u2', name: 'Dana Levi', image: null },
      path: '/workspaces/acme/reviews?tab=all-open&q=Dana%20Levi',
    })
    expect(personPath('acme', 'Dana Levi')).toBe(row?.path)
    expect(row?.peek.avatar).toMatchObject({ id: 'u2' })
    expect(row?.peek.rows).toEqual([
      { label: 'Teams', value: 'Web App, Docs' },
      { label: 'Open reviews', value: '2 requests' },
    ])
  })

  it('shows People as its own group, narrowed by the @ chip, and Show all when cut', () => {
    const found = results({
      people: [1, 2, 3].map(person),
      totals: { ...results().totals, people: 7 },
    })
    const view = buildList(input(), typed({ query: 'dana', results: found }))
    const group = view.groups.find((g) => g.label === 'People')?.entries
    expect(group?.at(-1)?.label).toBe('Show all 7 people')
    expect(group?.at(-1)?.target).toEqual({
      type: 'chip',
      chip: { type: 'kind', kind: 'people' },
    })
    const narrowed = buildList(
      input(),
      typed({ query: 'dana', chips: [{ type: 'kind', kind: 'people' }], results: found }),
    )
    expect(narrowed.kinds).toEqual(['people'])
    expect(flatten(narrowed.groups).map((e) => e.kind)).toEqual(['person', 'person', 'person'])
  })
})

describe('row actions', () => {
  it('offers a build Approve all, Reject, Request review…, Copy link and Open in new tab', () => {
    const rows = rowActionEntries(
      entryOf({
        subject: {
          type: 'build',
          workspace: 'acme',
          team: 'web',
          number: 148,
          label: 'build #148',
        },
      }),
    )
    expect(rows.map((e) => e.label)).toEqual([
      'Approve all',
      'Reject',
      'Request review…',
      'Copy link',
      'Open in new tab',
    ])
  })

  it('offers a triage item assign, snooze and dismiss, and a notice its read state', () => {
    const triage = rowActionEntries(
      entryOf({
        kind: 'triage',
        subject: {
          type: 'triage',
          workspace: 'acme',
          team: 'web',
          kind: 'flaky',
          key: 'k',
          label: 'k',
        },
      }),
    )
    expect(triage.map((e) => e.label)).toEqual([
      'Assign to me',
      'Snooze until tomorrow',
      'Snooze until next week',
      'Dismiss',
      'Copy link',
      'Open in new tab',
    ])
    const read = rowActionEntries(
      entryOf({ kind: 'notice', subject: { type: 'notice', id: 'n', read: true, label: 'n' } }),
    )
    expect(read[0]?.label).toBe('Mark as unread')
  })

  it('offers a row with nothing of its own only the link actions', () => {
    expect(rowActionEntries(entryOf({})).map((e) => e.label)).toEqual([
      'Copy link',
      'Open in new tab',
    ])
  })
})

describe('settings is closed', () => {
  it('offers only the frame sections and the way back, with the current section marked', () => {
    const view = insideSettings('')
    expect(headings(view)).toEqual(['In settings', 'Leave settings'])
    const sections = view.groups[0]?.entries ?? []
    expect(sections.map((e) => e.label)).toEqual(
      expect.arrayContaining(['Profile', 'Members', 'Teams', 'Integrations']),
    )
    expect(sections.find((e) => e.label === 'Members')?.detail).toBe('Workspace · Current')
    expect(view.groups[1]?.entries[0]).toMatchObject({
      label: 'Back to Inbox',
      target: { type: 'path', path: '/inbox' },
    })
    expect(labels(view)).not.toContain('Inbox')
    expect(labels(view)).not.toContain('Build #1')
  })

  it('shows no app result or page while something is typed, even a build number', () => {
    for (const q of ['148', 'inbox', 'check']) {
      const view = insideSettings(q)
      const rows = flatten(view.groups)
      expect(rows.map((e) => e.kind).filter((k) => k !== 'setting' && k !== 'action')).toEqual([])
      const paths = rows.map((e) => (e.target.type === 'path' ? e.target.path : ''))
      expect(
        paths.filter((p) => !/^\/(account|instance|workspaces\/acme\/settings|inbox$)/.test(p)),
      ).toEqual([])
    }
    expect(labels(insideSettings('mem'))).toEqual(['Members'])
  })

  it('hides the sections a member cannot use', () => {
    const member = settingsSections({ workspace: 'acme', canManage: false, instanceAdmin: false })
    const names = member.filter((s) => s.area === 'Workspace').map((s) => s.label)
    expect(names).toEqual(['Members', 'Teams'])
    expect(member.map((s) => s.label)).not.toContain('All workspaces')
    const admin = settingsSections({ workspace: 'acme', canManage: true, instanceAdmin: true })
    expect(admin.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Health', 'General', 'All workspaces']),
    )
  })

  it('lists a section outside settings only when the query names it', () => {
    const outside = (query: string) =>
      buildList(input({ pathname: '/acme/web', routeWorkspace: 'acme' }), typed({ query }))
    expect(labels(outside('members'))).toContain('Settings · Members')
    expect(labels(outside('settings'))).toContain('Settings · Members')
    expect(labels(outside('review rules'))).toContain('Settings · Review rules')
    expect(labels(buildList(input(), typed({ query: 'inbox' })))).not.toContain(
      'Settings · Members',
    )
    // Never as a result under an app page.
    expect(labels(buildList(input(), typed()))).not.toContain('Settings · Members')
  })
})

describe('the footer', () => {
  it('names what Enter does for the highlighted row', () => {
    const base = { nested: false, rowActions: false, removable: false }
    expect(hintText(footerHints({ ...base, entry: footerEntry('page', '/inbox') }))).toEqual([
      '↑ ↓ move',
      '↵ Go to',
      '⌘↵ New tab',
      'Esc close',
    ])
    expect(hintText(footerHints({ ...base, entry: footerEntry('action') }))).toContain('↵ Run')
    expect(hintText(footerHints({ ...base, entry: footerEntry('submenu') }))).toContain('↵ Choose')
    expect(hintText(footerHints({ ...base, entry: footerEntry('action') }))).not.toContain(
      '⌘↵ New tab',
    )
  })

  it('adds ⌘. for a row with actions and ⌫ when a scope can be removed', () => {
    const hints = hintText(
      footerHints({
        nested: false,
        entry: footerEntry('build', '/b'),
        rowActions: true,
        removable: true,
      }),
    )
    expect(hints).toContain('⌘. Actions')
    expect(hints).toContain('⌫ Remove scope')
  })

  it('shows Back, Choose and Esc back in a nested list', () => {
    expect(
      hintText(
        footerHints({
          nested: true,
          entry: footerEntry('choice'),
          rowActions: false,
          removable: false,
        }),
      ),
    ).toEqual(['← Back', '↵ Choose', 'Esc Back'])
  })
})

describe('Recent', () => {
  it('classifies builds, teams, baselines, triage items and views, and nothing else', () => {
    expect(visitAt('/acme/web/builds/148')?.entry).toMatchObject({
      kind: 'build',
      label: 'Build #148',
      detail: 'Web App',
    })
    expect(visitAt('/acme/web')?.entry).toMatchObject({ kind: 'team', label: 'Web App' })
    expect(visitAt('/acme/web/baselines/checkout/payment')?.entry).toMatchObject({
      kind: 'baseline',
      label: 'checkout/payment',
    })
    expect(visitAt('/acme/web/triage', '?item=flaky%3Acheckout%2Fsummary')?.entry).toMatchObject({
      kind: 'triage',
      label: 'checkout/summary',
    })
    expect(visitAt('/workspaces/acme/views/v1')?.entry).toMatchObject({
      kind: 'view',
      label: 'Checkout regressions',
    })
    expect(visitAt('/acme/web/triage')).toBeUndefined()
    expect(visitAt('/inbox')).toBeUndefined()
    expect(visitAt('/workspaces/acme/reviews')).toBeUndefined()
    expect(visitAt('/account/profile')).toBeUndefined()
    expect(visitAt('/acme/web/builds/148')?.workspace).toBe('acme')
  })

  it('says how long ago in minutes, hours and days', () => {
    expect(shortAgo(NOW, NOW)).toBe('just now')
    expect(shortAgo(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(shortAgo(NOW - 2 * 3_600_000, NOW)).toBe('2 h ago')
    expect(shortAgo(NOW - 3 * 86_400_000, NOW)).toBe('3 d ago')
  })
})

describe('keyEvents', () => {
  it('turns a registry key into key presses', () => {
    expect(keyEvents('mod+shift+c')).toEqual([
      { key: 'C', metaKey: true, shiftKey: true, bubbles: true },
    ])
    expect(keyEvents('g i')).toHaveLength(2)
    expect(keyEvents('a')).toEqual([{ key: 'a', metaKey: false, shiftKey: false, bubbles: true }])
  })
})
