import { describe, expect, it } from 'vitest'

import { peoplePalette, teamPalette, workspacePalette } from '../src/avatar-palettes.ts'
import { palettes } from '../src/theme.ts'

describe('avatar palettes', () => {
  it.each(['light', 'dark'] as const)('%s: every colour is a six digit hex', (scheme) => {
    const all = [
      ...peoplePalette(scheme),
      ...workspacePalette(scheme),
      ...teamPalette('plum', scheme),
    ]
    for (const colour of all) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has five shades of the team colour, which include the colour itself', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const shades = teamPalette('moss', scheme)
      expect(shades).toHaveLength(5)
      expect(new Set(shades).size).toBe(5)
      expect(shades).toContain(palettes[scheme].team.moss)
    }
  })

  it('differs by scheme', () => {
    expect(teamPalette('slate', 'light')).not.toEqual(teamPalette('slate', 'dark'))
    expect(peoplePalette('light')).not.toEqual(peoplePalette('dark'))
  })
})
