import { describe, expect, it } from 'vitest'

import { peoplePalette, projectPalette, workspacePalette } from '../src/avatar-palettes.ts'
import { palettes } from '../src/theme.ts'

describe('avatar palettes', () => {
  it.each(['light', 'dark'] as const)('%s: every colour is a six digit hex', (scheme) => {
    const all = [
      ...peoplePalette(scheme),
      ...workspacePalette(scheme),
      ...projectPalette('plum', scheme),
    ]
    for (const colour of all) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has five shades of the project colour, which include the colour itself', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const shades = projectPalette('moss', scheme)
      expect(shades).toHaveLength(5)
      expect(new Set(shades).size).toBe(5)
      expect(shades).toContain(palettes[scheme].project.moss)
    }
  })

  it('differs by scheme', () => {
    expect(projectPalette('slate', 'light')).not.toEqual(projectPalette('slate', 'dark'))
    expect(peoplePalette('light')).not.toEqual(peoplePalette('dark'))
  })
})
