import { describe, expect, it } from 'vitest'

import {
  assertTeamColor,
  assertTeamIcon,
  isTeamIcon,
  TEAM_COLORS,
  TEAM_ICON_NAMES,
  teamColorFor,
} from '../src/index.ts'

/** The 31 icons teams could pick before every Lucide icon was allowed: stored rows keep them. */
const OLD_ICONS = [
  'layout-grid',
  'book-open',
  'globe',
  'shopping-cart',
  'smartphone',
  'palette',
  'code',
  'box',
  'rocket',
  'layers',
  'compass',
  'flask-conical',
  'gauge',
  'monitor',
  'file-text',
  'chart-column',
  'credit-card',
  'users',
  'mail',
  'map',
  'camera',
  'puzzle',
  'zap',
  'shield',
  'store',
  'car',
  'heart',
  'leaf',
  'cloud',
  'terminal',
  'component',
] as const

describe('teamColorFor', () => {
  it('is deterministic and ignores case and edge spaces', () => {
    expect(teamColorFor('web-app')).toBe(teamColorFor('web-app'))
    expect(teamColorFor('  Web-App ')).toBe(teamColorFor('web-app'))
  })

  it('always returns a palette colour and spreads names over all six', () => {
    const seen = new Map<string, number>()
    for (let i = 0; i < 600; i += 1) {
      const color = teamColorFor(`team-${i}`)
      expect(TEAM_COLORS).toContain(color)
      seen.set(color, (seen.get(color) ?? 0) + 1)
    }
    expect(seen.size).toBe(TEAM_COLORS.length)
    // Roughly even: no colour takes more than twice its fair share.
    for (const n of seen.values()) expect(n).toBeLessThan(200)
  })
})

describe('icons and colours', () => {
  it('accepts every Lucide icon name once, sorted', () => {
    expect(TEAM_ICON_NAMES.length).toBeGreaterThan(1500)
    expect(new Set(TEAM_ICON_NAMES).size).toBe(TEAM_ICON_NAMES.length)
    expect(TEAM_ICON_NAMES.toSorted()).toEqual([...TEAM_ICON_NAMES])
    expect(isTeamIcon('rocket')).toBe(true)
    expect(isTeamIcon('dog')).toBe(true)
    expect(isTeamIcon('not-an-icon')).toBe(false)
    expect(isTeamIcon(42)).toBe(false)
  })

  it.each(OLD_ICONS)('still accepts the stored icon %s', (name) => {
    expect(isTeamIcon(name)).toBe(true)
  })

  it('rejects values outside the lists', () => {
    expect(() => assertTeamIcon('not-an-icon')).toThrow(/Unknown icon/)
    expect(() => assertTeamColor('red')).toThrow(/Colour must be/)
    expect(() => assertTeamColor('plum')).not.toThrow()
  })
})
