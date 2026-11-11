import { describe, expect, it } from 'vitest'

import {
  assertProjectColor,
  assertProjectIcon,
  isProjectIcon,
  PROJECT_COLORS,
  PROJECT_ICON_NAMES,
  projectColorFor,
} from '../src/index.ts'

/** The 31 icons projects could pick before every Lucide icon was allowed: stored rows keep them. */
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

describe('projectColorFor', () => {
  it('is deterministic and ignores case and edge spaces', () => {
    expect(projectColorFor('web-app')).toBe(projectColorFor('web-app'))
    expect(projectColorFor('  Web-App ')).toBe(projectColorFor('web-app'))
  })

  it('always returns a palette colour and spreads names over all six', () => {
    const seen = new Map<string, number>()
    for (let i = 0; i < 600; i += 1) {
      const color = projectColorFor(`project-${i}`)
      expect(PROJECT_COLORS).toContain(color)
      seen.set(color, (seen.get(color) ?? 0) + 1)
    }
    expect(seen.size).toBe(PROJECT_COLORS.length)
    // Roughly even: no colour takes more than twice its fair share.
    for (const n of seen.values()) expect(n).toBeLessThan(200)
  })
})

describe('icons and colours', () => {
  it('accepts every Lucide icon name once, sorted', () => {
    expect(PROJECT_ICON_NAMES.length).toBeGreaterThan(1500)
    expect(new Set(PROJECT_ICON_NAMES).size).toBe(PROJECT_ICON_NAMES.length)
    expect(PROJECT_ICON_NAMES.toSorted()).toEqual([...PROJECT_ICON_NAMES])
    expect(isProjectIcon('rocket')).toBe(true)
    expect(isProjectIcon('dog')).toBe(true)
    expect(isProjectIcon('not-an-icon')).toBe(false)
    expect(isProjectIcon(42)).toBe(false)
  })

  it.each(OLD_ICONS)('still accepts the stored icon %s', (name) => {
    expect(isProjectIcon(name)).toBe(true)
  })

  it('rejects values outside the lists', () => {
    expect(() => assertProjectIcon('not-an-icon')).toThrow(/Unknown icon/)
    expect(() => assertProjectColor('red')).toThrow(/Colour must be/)
    expect(() => assertProjectColor('plum')).not.toThrow()
  })
})
