import { describe, expect, it } from 'vitest'

import { type ColorScheme, palettes, tokens, tokenVariables } from '../src/index.ts'

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const SCHEMES: ColorScheme[] = ['dark', 'light']

describe('palettes', () => {
  for (const scheme of SCHEMES) {
    const p = palettes[scheme]
    const surfaces = Object.values(p.surface)

    it(`${scheme}: body text and accent text read at 4.5:1 on every surface`, () => {
      for (const surface of surfaces) {
        for (const ink of [p.text.primary, p.text.secondary, p.text.tertiary, p.accent.text]) {
          expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${scheme}: state colours stand out at 3:1 on every surface (glyphs, not text)`, () => {
      for (const surface of surfaces) {
        for (const ink of Object.values(p.state)) {
          expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it(`${scheme}: text on the accent fill reads at 4.5:1`, () => {
      expect(contrast(p.accent.onAccent, p.accent.main)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('gives both schemes the same set of tokens and the same brand tones', () => {
    expect(Object.keys(tokenVariables('light'))).toEqual(Object.keys(tokenVariables('dark')))
    expect(palettes.light.brand).toEqual(palettes.dark.brand)
  })
})

describe('tokens', () => {
  it('are CSS variables that both schemes define', () => {
    expect(tokens.surface.panel).toBe('var(--circi-surface-panel)')
    expect(tokens.accent.onAccent).toBe('var(--circi-accent-on-accent)')
    expect(tokenVariables('light')['--circi-surface-panel']).toBe(palettes.light.surface.panel)
    for (const group of Object.values(tokens)) {
      for (const ref of Object.values(group)) {
        expect(Object.keys(tokenVariables('dark'))).toContain(ref.slice(4, -1))
      }
    }
  })
})
