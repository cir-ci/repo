import type { Search } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  contextActions,
  contextScopes,
  emptyQueryEntries,
  flatten,
  groupEntries,
  type JumpInput,
  keyEvents,
  localMatches,
  parseBuildQuery,
  searchEntries,
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

const MEMBERS = { memberCount: 1, memberPreview: [], youAreMember: true }

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
        'Inbox',
        'Reviews',
        'Teams',
        'Insights',
        'Settings',
        'Web',
        'Failing',
      ]),
    )
    expect(labels).not.toContain('API')
    const inbox = emptyQueryEntries('/', jump, 'system').find((e) => e.label === 'Inbox')
    expect(inbox?.hint).toBe('g i')
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
    expect(groups).toEqual(['Actions', 'Jump to', 'Preferences'])
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
    expect(localMatches('inbox', '/', jump, 'system').map((e) => e.label)).toContain('Inbox')
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

describe('keyEvents', () => {
  it('turns a registry key into key presses', () => {
    expect(keyEvents('mod+shift+c')).toEqual([
      { key: 'C', metaKey: true, shiftKey: true, bubbles: true },
    ])
    expect(keyEvents('g i')).toHaveLength(2)
    expect(keyEvents('a')).toEqual([{ key: 'a', metaKey: false, shiftKey: false, bubbles: true }])
  })
})
