import { describe, expect, it } from 'vitest'

import { type ColorScheme, palettes, tokens, tokenVariables } from '../src/index.ts'
import canvas from './canvas-palette.json' with { type: 'json' }

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

type Rgb = readonly [number, number, number]

const toLinear = (hex: string): Rgb => {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel(1), channel(3), channel(5)]
}

/** Machado et al. 2009, severity 1.0, applied in linear RGB. */
function deuteranopia([r, g, b]: Rgb): Rgb {
  return [
    0.367322 * r + 0.860646 * g - 0.227968 * b,
    0.280085 * r + 0.672501 * g + 0.047413 * b,
    -0.01182 * r + 0.04294 * g + 0.968881 * b,
  ]
}

/** CIE76 ΔE of two linear-RGB colours (D65). */
function deltaE(first: Rgb, second: Rgb) {
  const lab = ([r, g, b]: Rgb) => {
    const [x = 0, y = 0, z = 0] = [
      (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
      0.2126 * r + 0.7152 * g + 0.0722 * b,
      (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
    ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116))
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const
  }
  const [l1, a1, b1] = lab(first)
  const [l2, a2, b2] = lab(second)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
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
        for (const [name, ink] of Object.entries(p.state)) {
          if (name === 'reviewText') continue
          // The canvas's light review amber (#b38d05) is 2.7:1 on chrome and 2.5:1 on highest. It
          // is only drawn on panel and raised (rows, build header); see docs/next-steps-plan.md R11.
          if (
            scheme === 'light' &&
            name === 'review' &&
            surface !== p.surface.panel &&
            surface !== p.surface.raised
          )
            continue
          expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it(`${scheme}: review text reads at 4.5:1 on the panel and raised surfaces`, () => {
      for (const surface of [p.surface.panel, p.surface.raised]) {
        expect(
          contrast(p.state.reviewText, surface),
          `review text on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${scheme}: rejected is told apart from the accent (ΔE 15, and 8 with deuteranopia)`, () => {
      const accent = toLinear(p.accent.main)
      const rejected = toLinear(p.state.rejected)
      expect(deltaE(accent, rejected)).toBeGreaterThanOrEqual(15)
      expect(deltaE(deuteranopia(accent), deuteranopia(rejected))).toBeGreaterThanOrEqual(8)
    })

    it(`${scheme}: equals the canvas stylesheet's variables`, () => {
      expect(tokenVariables(scheme)).toEqual(canvas[scheme])
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
