import type { Search } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  contextActions,
  contextScopes,
  emptyQueryEntries,
  flatten,
  groupEntries,
  keyEvents,
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

describe('the empty query', () => {
  const jump = {
    workspace: 'acme',
    teams: [
      { slug: 'web', name: 'Web', pinned: true, triage: 0 },
      { slug: 'api', name: 'API', pinned: false, triage: 0 },
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

  it('lists pages, only pinned teams and saved views, with the registry key as the hint', () => {
    const labels = emptyQueryEntries('/', jump).map((e) => e.label)
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
    const inbox = emptyQueryEntries('/', jump).find((e) => e.label === 'Inbox')
    expect(inbox?.hint).toBe('g i')
  })

  it('offers the build review actions on a build page, from the registry', () => {
    expect(contextScopes('/acme/web/builds/148')).toEqual(['build-review'])
    const actions = contextActions('/acme/web/builds/148')
    const labels = actions.map((e) => e.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Approve all changes',
        'Reject the build, with a reason',
        'Copy link to this page',
      ]),
    )
    // Each entry is a registry key, so its hint is declared once.
    for (const a of actions) {
      expect(SHORTCUTS.some((s) => s.key === a.hint && s.description === a.label)).toBe(true)
    }
  })

  it('offers list actions, not review ones, on a list', () => {
    const labels = contextActions('/acme/web').map((e) => e.label)
    expect(labels).toContain('Request review')
    expect(labels).not.toContain('Approve all changes')
  })

  it('puts the actions before the places to jump to', () => {
    const groups = groupEntries(emptyQueryEntries('/acme/web/builds/1', jump)).map((g) => g.group)
    expect(groups).toEqual(['Actions', 'Jump to'])
  })
})

describe('search entries', () => {
  it('orders the groups Builds, Branches, Teams, Snapshots and links each', () => {
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
    expect(groups.map((g) => g.group)).toEqual(['Builds', 'Branches', 'Teams', 'Snapshots'])
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
