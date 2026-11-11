import { describe, expect, it } from 'vitest'

import { parseIgnoreRegionsSearch } from '#features/regions/ignore-regions-search.ts'
import {
  parseRect,
  pickSnapshot,
  regionsOf,
  sizeOf,
  toFractions,
  toPixels,
} from '#features/regions/ignore-regions.ts'
import {
  branchProblem,
  buildSettingsPatch,
  settingsProblems,
  slugProblem,
} from '#features/team-settings/settings-patch.ts'
import { webhookProblems } from '#features/team-settings/webhook-events.ts'
import { appearancePatch, filterIcons, iconColumns, iconLabel } from '#features/teams/appearance.ts'

describe('team appearance', () => {
  it('fits as many 36 px icon cells with 4 px gaps as the grid is wide, at least one', () => {
    // 8 px of padding, then n cells and n - 1 gaps.
    expect(iconColumns(8 + 36)).toBe(1)
    expect(iconColumns(8 + 36 * 6 + 4 * 5)).toBe(6)
    expect(iconColumns(8 + 36 * 6 + 4 * 5 - 1)).toBe(5)
    expect(iconColumns(0)).toBe(1)
  })

  it('offers every Lucide icon and filters by every word typed', () => {
    expect(filterIcons('').length).toBeGreaterThan(1500)
    expect(filterIcons('flask')).toContain('flask-conical')
    expect(filterIcons('  BOOK open ')).toContain('book-open')
    expect(filterIcons('  BOOK open ').every((n) => n.includes('book') && n.includes('open'))).toBe(
      true,
    )
    expect(filterIcons('zzz')).toEqual([])
  })

  it('ranks the exact name, then names starting with the word, before the rest', () => {
    const found = filterIcons('dog')
    expect(found[0]).toBe('dog')
    expect(
      filterIcons('bar')
        .slice(0, 2)
        .every((n) => n.startsWith('bar')),
    ).toBe(true)
    expect(filterIcons('cart')).toContain('shopping-cart')
    expect(filterIcons('shopping-cart')[0]).toBe('shopping-cart')
  })

  it('labels an icon from its name', () => {
    expect(iconLabel('shopping-cart')).toBe('Shopping cart')
    expect(iconLabel('dog')).toBe('Dog')
  })

  it('sends only what changed', () => {
    const current = { color: 'slate', icon: null }
    expect(appearancePatch(current, { color: 'plum', icon: null })).toEqual({ color: 'plum' })
    expect(appearancePatch(current, { color: 'slate', icon: 'globe' })).toEqual({ icon: 'globe' })
    expect(
      appearancePatch({ color: 'slate', icon: 'globe' }, { color: 'slate', icon: null }),
    ).toEqual({ icon: null })
    expect(appearancePatch(current, { color: 'slate', icon: null })).toEqual({})
  })
})

describe('General settings patch', () => {
  const fields = {
    diffThresholdPercent: '2.5',
    retentionDays: '90',
    autoApprove: true,
    blockMerge: false,
    flaky: 'inherit' as const,
    hosting: true,
  }
  it('converts the percentage and inherits the flaky setting', () => {
    expect(buildSettingsPatch(fields, false)).toEqual({
      diffThreshold: 0.025,
      retentionDays: 90,
      autoApproveDefaultBranch: true,
      blockMergeOnChanges: false,
      flakyBlocksMerge: null,
    })
  })
  it('includes hosting only when the instance can host sites', () => {
    expect(buildSettingsPatch(fields, true)).toMatchObject({ staticHostingEnabled: true })
  })
})

describe('General settings problems', () => {
  const ok = {
    diffThresholdPercent: '2.5',
    retentionDays: '30',
  }

  it('has none for sensible values', () => {
    expect(settingsProblems(ok)).toEqual({})
    expect(settingsProblems({ ...ok, diffThresholdPercent: '0', retentionDays: '3650' })).toEqual(
      {},
    )
    expect(settingsProblems({ ...ok, diffThresholdPercent: '100', retentionDays: '1' })).toEqual({})
  })

  it('keeps the threshold between 0 and 100 percent', () => {
    for (const bad of ['', '-0.1', '100.5', '150', 'abc'])
      expect(settingsProblems({ ...ok, diffThresholdPercent: bad }).diffThreshold).toBe(
        'Enter a percentage from 0 to 100',
      )
  })

  it('keeps retention a whole number of days from 1 to 3650', () => {
    for (const bad of ['', '0', '3651', '1.5', '-3', 'x'])
      expect(settingsProblems({ ...ok, retentionDays: bad }).retentionDays).toBe(
        'Enter a whole number of days from 1 to 3650',
      )
  })

  it('wants an address, and leaves an old one alone until it is edited', () => {
    expect(slugProblem(' ')).toBe('Enter an address')
    expect(slugProblem('web')).toBeNull()
    expect(slugProblem('Old_Slug')).toMatch(/lowercase/)
    expect(slugProblem('Old_Slug', 'Old_Slug')).toBeNull()
    expect(slugProblem('settings')).toMatch(/lowercase/)
  })

  it('wants a branch name', () => {
    expect(branchProblem(' ')).toBe('Enter a branch name')
    expect(branchProblem('main')).toBeNull()
  })
})

describe('webhook form', () => {
  it('reports both problems at once', () => {
    expect(webhookProblems(' ', [])).toEqual({
      url: 'Enter an address',
      events: 'Choose at least one event',
    })
    expect(webhookProblems('https://a.test', ['build.completed'])).toEqual({
      url: null,
      events: null,
    })
  })
})

const r = (id: string, name: string, createdAt: string) => ({
  id,
  name,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  createdAt,
  createdBy: null,
})
const s = (name: string) => ({ name, regions: 1, latest: null })

describe('ignore regions', () => {
  const size = { width: 1000, height: 500 }
  it('reads the size of the latest screenshot', () => {
    expect(sizeOf(null)).toBeNull()
    expect(sizeOf({ buildNumber: 1, sha256: 'a', width: null, height: 5 })).toBeNull()
    expect(sizeOf({ buildNumber: 1, sha256: 'a', width: 1000, height: 500 })).toEqual(size)
  })

  it('converts between pixels and fractions', () => {
    const item = {
      id: 'r',
      name: 'n',
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      createdAt: '',
      createdBy: null,
    }
    expect(toFractions(item, size)).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(toPixels({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, size)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    })
  })

  it('keeps a drawn region inside the image and at least a pixel big', () => {
    expect(toPixels({ x: 0.95, y: 0.95, width: 0.5, height: 0.5 }, size)).toEqual({
      x: 950,
      y: 475,
      width: 50,
      height: 25,
    })
    expect(toPixels({ x: 0, y: 0, width: 0.0001, height: 0.0001 }, size)).toMatchObject({
      width: 1,
      height: 1,
    })
  })

  it("lists a name's regions newest first", () => {
    expect(
      regionsOf(
        [r('a', 'n', '2026-01-01'), r('b', 'n', '2026-02-01'), r('c', 'm', '2026-03-01')],
        'n',
      ).map((x) => x.id),
    ).toEqual(['b', 'a'])
  })

  it('picks the asked-for snapshot, else the first', () => {
    expect(pickSnapshot([s('a'), s('b')], 'b')?.name).toBe('b')
    expect(pickSnapshot([s('a'), s('b')], 'zzz')?.name).toBe('a')
    expect(pickSnapshot([])).toBeUndefined()
  })

  it('checks typed rectangles', () => {
    expect(parseRect({ x: '1', y: '2', width: '3', height: '4' })).toEqual({
      ok: true,
      rect: { x: 1, y: 2, width: 3, height: 4 },
    })
    expect(parseRect({ x: '1.5', y: '2', width: '3', height: '4' })).toMatchObject({ ok: false })
    expect(parseRect({ x: '', y: '2', width: '3', height: '4' })).toMatchObject({ ok: false })
    expect(parseRect({ x: '-1', y: '2', width: '3', height: '4' })).toMatchObject({ ok: false })
    expect(parseRect({ x: '1', y: '2', width: '0', height: '4' })).toMatchObject({ ok: false })
  })

  it('reads ?name= and ignores anything else', () => {
    expect(parseIgnoreRegionsSearch({ name: 'a/b' })).toEqual({ name: 'a/b' })
    expect(parseIgnoreRegionsSearch({ name: 3 })).toEqual({})
  })
})
