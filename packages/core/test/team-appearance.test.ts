import { describe, expect, it } from 'vitest'

import {
  assertTeamColor,
  assertTeamIcon,
  isTeamIcon,
  TEAM_COLORS,
  TEAM_ICON_NAMES,
  teamColorFor,
} from '../src/index.ts'

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
  it('has the 31 canvas icons, unique', () => {
    expect(TEAM_ICON_NAMES).toHaveLength(31)
    expect(new Set(TEAM_ICON_NAMES).size).toBe(31)
    expect(isTeamIcon('rocket')).toBe(true)
    expect(isTeamIcon('trash')).toBe(false)
  })

  it('rejects values outside the lists', () => {
    expect(() => assertTeamIcon('trash')).toThrow(/Unknown icon/)
    expect(() => assertTeamColor('red')).toThrow(/Colour must be/)
    expect(() => assertTeamColor('plum')).not.toThrow()
  })
})
