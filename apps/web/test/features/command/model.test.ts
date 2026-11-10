import type { Search } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  commandContext,
  contextActions,
  contextScopes,
  emptyQueryEntries,
  flatten,
  groupEntries,
  type JumpInput,
  jumpEntries,
  keyEvents,
  localMatches,
  parseBuildQuery,
  searchEntries,
  uniqueEntries,
  wrapIndex,
} from '#features/command/model.ts'
import { SHORTCUTS } from '#lib/shortcuts.ts'

const build = (over: Partial<Search.Build> = {}): Search.Build => ({
  teamSlug: 'web',
  teamName: 'Web',
  number: 148,
  name: 'Checkout',
  branch: 'main',
  prNumber: null,
  status: 'complete',
  reviewStatus: 'pending',
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
  ...over,
})

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
    expect(wrapIndex(3, 1, 1)).toBe(2)
  })
  it('starts at an end when nothing is highlighted, and is -1 for an empty list', () => {
    expect(wrapIndex(3, -1, 1)).toBe(0)
    expect(wrapIndex(3, -1, -1)).toBe(2)
    expect(wrapIndex(0, 0, 1)).toBe(-1)
  })
})

const MEMBERS = { memberCount: 1, memberPreview: [], siteCount: 0, youAreMember: true }

describe('the empty query', () => {
  const jump: JumpInput = {
    workspace: 'acme',
    teams: [
      { slug: 'web', name: 'Web', color: 'slate', icon: null, pinned: true, triage: 0, ...MEMBERS },
      {
        slug: 'api',
        name: 'API',
        color: 'slate',
        icon: null,
        pinned: false,
        triage: 0,
        ...MEMBERS,
      },
    ],
    views: [
      {
        id: 'v1',
        name: 'Failing',
        filters: {},
        pinned: false,
        position: 0,
        team: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }

  it("sends Settings to Members for people who can't change the workspace settings", () => {
    for (const [canManage, path] of [
      [true, '/workspaces/acme/settings'],
      [false, '/workspaces/acme/settings/members'],
    ] as const) {
      const entry = emptyQueryEntries('/', { ...jump, canManage }, 'system').find(
        (e) => e.id === 'jump:settings',
      )
      expect(entry?.target).toEqual({ type: 'path', path })
    }
  })

  it('lists pages, only pinned teams and saved views, with the registry key as the hint', () => {
    const labels = emptyQueryEntries('/', jump, 'system').map((e) => e.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Open Inbox',
        'Open Reviews',
        'Open Teams',
        'Open Insights',
        'Open Settings',
        'Web',
        'Failing',
        'Keyboard shortcuts',
      ]),
    )
    expect(labels).not.toContain('API')
    const inbox = emptyQueryEntries('/', jump, 'system').find((e) => e.label === 'Open Inbox')
    expect(inbox?.hint).toBe('g i')
    const shortcuts = emptyQueryEntries('/', jump, 'system').find((e) => e.id === 'pref:shortcuts')
    expect(shortcuts).toMatchObject({
      group: 'Preferences',
      hint: '?',
      target: { type: 'key', key: '?' },
    })
  })

  it('offers the build review actions on a build page, from the registry', () => {
    expect(contextScopes('/acme/web/builds/148')).toEqual(['build-review'])
    const actions = contextActions('/acme/web/builds/148')
    const labels = actions.map((e) => e.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Approve screenshot',
        'Approve all',
        'Reject screenshot, with a reason',
        'Copy link to this page',
      ]),
    )
    // Each entry is a registry key, so its hint is declared once.
    for (const a of actions) {
      expect(SHORTCUTS.some((s) => s.key === a.hint && s.description === a.label)).toBe(true)
    }
  })

  it('offers no action that nothing on the page would handle', () => {
    // A team's Builds page binds neither snooze nor request review (they need a selected request).
    const labels = contextActions('/acme/web').map((e) => e.label)
    expect(labels).not.toContain('Request review')
    expect(labels).not.toContain('Snooze')
    expect(labels).not.toContain('Approve all')
    expect(labels).toContain('Copy link to this page')
  })

  it('offers Request review on a build, and Snooze on the pages that snooze', () => {
    const onBuild = contextActions('/acme/web/builds/148').map((e) => e.label)
    expect(onBuild).toContain('Request review')
    expect(onBuild).not.toContain('Snooze')
    expect(contextActions('/workspaces/acme/reviews').map((e) => e.label)).toEqual(
      expect.arrayContaining(['Snooze', 'Request review']),
    )
    expect(contextActions('/inbox').map((e) => e.label)).toContain('Snooze')
    expect(contextActions('/acme/web/triage').map((e) => e.label)).toContain('Snooze')
  })

  it('puts the actions before the places to jump to, then the theme', () => {
    const groups = groupEntries(emptyQueryEntries('/acme/web/builds/1', jump, 'system')).map(
      (g) => g.group,
    )
    expect(groups).toEqual(['Actions', 'Jump to', 'Navigate', 'Preferences'])
  })
})

describe('the context of a page', () => {
  const teams = [
    {
      slug: 'web',
      name: 'web-app',
      color: 'slate' as const,
      icon: null,
      pinned: true,
      triage: 0,
      ...MEMBERS,
    },
  ]

  it('names the build you are on, and the heading of its actions', () => {
    expect(commandContext('/acme/web/builds/148', teams)).toEqual({
      chip: 'web-app · #148',
      actions: 'Build #148',
    })
    expect(commandContext('/acme/other/builds/7', teams)?.chip).toBe('other · #7')
  })

  it('has none anywhere else', () => {
    expect(commandContext('/inbox', teams)).toBeUndefined()
    expect(commandContext('/acme/web', teams)).toBeUndefined()
  })

  it('heads the actions group with that name', () => {
    const entries = emptyQueryEntries(
      '/acme/web/builds/1',
      { workspace: 'acme', teams: [], views: [] },
      'system',
    )
    expect(groupEntries(entries, 'Build #1')[0]).toMatchObject({
      group: 'Actions',
      label: 'Build #1',
    })
    expect(groupEntries(entries)[0]?.label).toBe('Actions')
  })
})

describe('local matches', () => {
  const jump: JumpInput = { workspace: 'acme', teams: [], views: [] }

  it('finds the theme choices for "theme", marking the one in use', () => {
    const entries = localMatches('theme', '/', jump, 'dark')
    expect(entries.map((e) => e.label)).toEqual(['Theme: System', 'Theme: Light', 'Theme: Dark'])
    expect(entries.find((e) => e.detail === 'Current')?.label).toBe('Theme: Dark')
    expect(entries[1]?.target).toEqual({ type: 'theme', mode: 'light' })
  })

  it('needs every word typed, in any case, and finds pages too', () => {
    expect(localMatches('THEME dark', '/', jump, 'system').map((e) => e.label)).toEqual([
      'Theme: Dark',
    ])
    expect(localMatches('inbox', '/', jump, 'system').map((e) => e.label)).toContain('Open Inbox')
    expect(localMatches('zzzq', '/', jump, 'system')).toEqual([])
  })
})

describe('search entries', () => {
  it('orders the groups Builds, Branches, Teams, Screenshots and links each', () => {
    const entries = searchEntries(
      'acme',
      'web',
      results({
        snapshots: [{ teamSlug: 'web', teamName: 'Web', name: 'Home page', latestBuildNumber: 7 }],
        teams: [{ slug: 'web', name: 'Web' }],
        branches: [{ teamSlug: 'web', teamName: 'Web', branch: 'main', latestBuildNumber: 9 }],
        builds: [build()],
      }),
    )
    const groups = groupEntries(entries)
    expect(groups.map((g) => g.group)).toEqual(['Builds', 'Branches', 'Teams', 'Screenshots'])
    const paths = flatten(groups).map((e) => (e.target.type === 'path' ? e.target.path : ''))
    expect(paths).toEqual([
      '/acme/web/builds/148',
      '/acme/web/builds/9',
      '/acme/web',
      '/acme/web/builds/7?shot=Home%20page',
    ])
  })

  it('ranks the build with the typed number ahead of one that matches as a pull request', () => {
    const entries = searchEntries(
      'acme',
      '#148',
      results({ builds: [build({ number: 150, prNumber: 148 }), build({ number: 148 })] }),
    )
    expect(entries.map((e) => e.id)).toEqual(['build:web:148', 'build:web:150'])
  })

  it('jumps to the build in the open team before the answer arrives, without doubling it', () => {
    const open = { slug: 'web', name: 'Web' }
    const early = searchEntries('acme', '148', undefined, open)
    expect(early).toHaveLength(1)
    expect(early[0]?.target).toEqual({ type: 'path', path: '/acme/web/builds/148' })
    const later = searchEntries('acme', '148', results({ builds: [build()] }), open)
    expect(later).toHaveLength(1)
  })

  it('gives builds, branches, teams and snapshots a quick look from what the result has', () => {
    const entries = searchEntries(
      'acme',
      'x',
      results({
        builds: [build({ branch: 'feat', prNumber: 4 })],
        teams: [{ slug: 'web', name: 'Web' }],
      }),
    )
    expect(entries[0]?.preview?.rows).toEqual(
      expect.arrayContaining([
        { label: 'Branch', value: 'feat' },
        { label: 'Pull request', value: '#4' },
        { label: 'Review', value: 'Awaiting review' },
      ]),
    )
    expect(entries[1]?.preview?.title).toBe('Web')
  })
})

describe('search entries of the other kinds', () => {
  const more = results({
    baselines: [{ teamSlug: 'web', teamName: 'Web', name: 'checkout/summary', buildNumber: 140 }],
    triage: [
      {
        teamSlug: 'web',
        teamName: 'Web',
        kind: 'flaky',
        key: 'nav/header',
        snapshotName: 'nav/header',
        buildNumber: 150,
        branch: 'main',
      },
      {
        teamSlug: 'web',
        teamName: 'Web',
        kind: 'failed',
        key: 'build:142',
        snapshotName: null,
        buildNumber: 142,
        branch: 'main',
      },
    ],
    notifications: [
      {
        id: 'n1',
        kind: 'build_rejected',
        tab: 'snoozed',
        read: false,
        createdAt: '2026-03-10T12:00:00.000Z',
        actor: { name: 'Ada' },
        build: { number: 148, name: 'default' },
        team: { slug: 'web', name: 'Web' },
        payload: { reason: 'spacing is off' },
      },
    ],
    reviews: [
      {
        id: 'r1',
        tab: 'created',
        teamSlug: 'web',
        teamName: 'Web',
        build: { number: 148, name: 'default', branch: 'main' },
        reviewer: { name: 'Grace' },
        requestedBy: { name: 'Ada' },
      },
    ],
    views: [{ id: 'v1', name: 'Mine', team: null }],
  })

  const path = (id: string) => {
    const e = searchEntries('acme', 'x', more).find((x) => x.id === id)
    return e?.target.type === 'path' ? e.target.path : undefined
  }
  const rows = (id: string) =>
    searchEntries('acme', 'x', more).find((x) => x.id === id)?.preview?.rows

  it('groups them after Screenshots, each labelled by its own name', () => {
    const groups = groupEntries(searchEntries('acme', 'x', more))
    expect(groups.map((g) => g.group)).toEqual([
      'Jump to',
      'Baselines',
      'Triage',
      'Inbox',
      'Reviews',
    ])
    expect(flatten(groups).map((e) => e.label)).toEqual([
      'Mine',
      'checkout/summary',
      'nav/header',
      'Build #142 failed',
      'Ada rejected build #148',
      'Build #148 · main',
    ])
  })

  it('opens each with the item selected', () => {
    expect(path('baseline:web:checkout/summary')).toBe('/acme/web/baselines/checkout/summary')
    expect(path('triage:web:flaky:nav/header')).toBe('/acme/web/triage?item=flaky%3Anav%2Fheader')
    expect(path('triage:web:failed:build:142')).toBe('/acme/web/triage?item=failed%3Abuild%3A142')
    expect(path('notification:n1')).toBe('/inbox?tab=snoozed&item=n1')
    expect(path('review:r1')).toBe('/workspaces/acme/reviews?tab=created&review=r1')
    expect(path('view:v1')).toBe('/workspaces/acme/views/v1')
  })

  it('has key facts for the peek pane', () => {
    expect(rows('triage:web:flaky:nav/header')).toEqual(
      expect.arrayContaining([
        { label: 'Kind', value: 'Flaky' },
        { label: 'Build', value: '#150' },
        { label: 'Branch', value: 'main' },
      ]),
    )
    expect(rows('notification:n1')).toEqual(
      expect.arrayContaining([
        { label: 'Message', value: 'spacing is off' },
        { label: 'From', value: 'Ada' },
        { label: 'Status', value: 'Unread' },
      ]),
    )
    expect(rows('review:r1')).toEqual(
      expect.arrayContaining([
        { label: 'Reviewer', value: 'Grace' },
        { label: 'In', value: 'Created by you' },
      ]),
    )
    expect(rows('baseline:web:checkout/summary')).toEqual(
      expect.arrayContaining([{ label: 'From build', value: '#140' }]),
    )
  })

  it('shows a saved view once, though it is also a menu entry', () => {
    const jump = jumpEntries({
      workspace: 'acme',
      teams: [],
      views: [
        {
          id: 'v1',
          name: 'Mine',
          filters: {},
          pinned: false,
          position: 0,
          team: null,
          createdAt: '',
        },
      ],
    })
    const all = uniqueEntries([...jump, ...searchEntries('acme', 'mi', more)])
    expect(all.filter((e) => e.id === 'view:v1')).toHaveLength(1)
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
