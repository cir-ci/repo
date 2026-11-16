import { describe, expect, it } from 'vitest'

import { type ColorScheme, palettes, tokens, tokenVariables } from '#src/index.ts'

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

/** `fg` at `alpha` over `bg`, as `#rrggbb`. */
function blend(fg: string, bg: string, alpha: number) {
  const mixed = [1, 3, 5].map((i) => {
    const f = Number.parseInt(fg.slice(i, i + 2), 16)
    const b = Number.parseInt(bg.slice(i, i + 2), 16)
    return Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  })
  return `#${mixed.join('')}`
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

    it(`${scheme}: state colours stand out at 3:1 on every surface (glyphs, not text; review included in light)`, () => {
      for (const surface of surfaces) {
        for (const [name, ink] of Object.entries(p.state)) {
          // The muted failed fill (large bars) is the owner-approved exception to 3:1: it is read through
          // tooltips, the table view and 2px gaps, and has its own check below.
          if (name.endsWith('Text') || name === 'failedFill') continue
          expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it(`${scheme}: badge text reads at 4.5:1 on a 14% tint of its own colour over raised`, () => {
      const texts = {
        approved: p.state.approvedText,
        review: p.state.reviewText,
        processing: p.state.processing,
        failed: p.state.failedText,
        rejected: p.state.rejectedText,
      }
      for (const [name, ink] of Object.entries(texts)) {
        // The tint is the glyph colour, not the text colour.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `name` is a key of `texts`, which are state names
        const tint = blend(p.state[name as keyof typeof texts], p.surface.raised, 0.14)
        expect(contrast(ink, tint), `${name} text ${ink} on ${tint}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${scheme}: badge text reads at 4.5:1 on the 16% tint over every surface (the Insights pills, selected rows)`, () => {
      const texts = {
        approved: p.state.approvedText,
        review: p.state.reviewText,
        processing: p.state.processing,
        failed: p.state.failedText,
        rejected: p.state.rejectedText,
      }
      for (const surface of surfaces) {
        for (const [name, ink] of Object.entries(texts)) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `name` is a key of `texts`, which are state names
          const tint = blend(p.state[name as keyof typeof texts], surface, 0.16)
          expect(contrast(ink, tint), `${name} text ${ink} on ${tint}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${scheme}: the muted failed fill is crimson mixed 60% into the raised surface, and still reads against it`, () => {
      expect(p.state.failedFill.toLowerCase()).toBe(
        blend(p.state.failed, p.surface.raised, 0.6).toLowerCase(),
      )
      expect(contrast(p.state.failedFill, p.surface.raised)).toBeGreaterThanOrEqual(2.2)
    })

    it(`${scheme}: tile text reads at 4.5:1 on every project colour`, () => {
      for (const [name, fill] of Object.entries(p.project)) {
        expect(contrast(p.other.tileText, fill), `tile text on ${name}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${scheme}: project colours are ΔE 15 from state colours, accent, annotation and each other`, () => {
      const others: [string, string][] = [
        ...Object.entries(p.state)
          // The failed fill is crimson thinned for bars, not an identity of its own.
          .filter(([name]) => !name.endsWith('Text') && name !== 'failedFill')
          .map(([name, hex]): [string, string] => [`state.${name}`, hex]),
        ['accent.main', p.accent.main],
        ['annotation', p.other.annotation],
      ]
      const project = Object.entries(p.project)
      const failures: string[] = []
      for (const [name, hex] of project) {
        for (const [otherName, otherHex] of others) {
          const d = deltaE(toLinear(hex), toLinear(otherHex))
          if (d < 15) failures.push(`${scheme} project.${name} vs ${otherName}: ${d.toFixed(1)}`)
        }
      }
      for (const [i, [name, hex]] of project.entries()) {
        for (const [otherName, otherHex] of project.slice(i + 1)) {
          const d = deltaE(toLinear(hex), toLinear(otherHex))
          if (d < 15)
            failures.push(`${scheme} project.${name} vs project.${otherName}: ${d.toFixed(1)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${scheme}: region hues read at 3:1 on every surface, carry their number at 4.5:1 and are told apart (ΔE 25)`, () => {
      const hues = Object.entries(p.region)
      for (const [name, hex] of hues) {
        for (const surface of surfaces) {
          expect(contrast(hex, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
        expect(contrast(p.other.regionInk, hex), `ink on ${name}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const [i, [name, hex]] of hues.entries()) {
        for (const [otherName, otherHex] of hues.slice(i + 1)) {
          const d = deltaE(toLinear(hex), toLinear(otherHex))
          expect(d, `${name} vs ${otherName}`).toBeGreaterThanOrEqual(25)
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

    it(`${scheme}: failed is told apart from the accent (ΔE 15, and 8 with deuteranopia)`, () => {
      const accent = toLinear(p.accent.main)
      const failed = toLinear(p.state.failed)
      expect(deltaE(accent, failed)).toBeGreaterThanOrEqual(15)
      expect(deltaE(deuteranopia(accent), deuteranopia(failed))).toBeGreaterThanOrEqual(8)
    })

    it(`${scheme}: rejected (rose) is told apart from failed, review, approved, processing, the annotation and the accent`, () => {
      const rejected = toLinear(p.state.rejected)
      const others = {
        failed: p.state.failed,
        review: p.state.review,
        approved: p.state.approved,
        processing: p.state.processing,
        annotation: p.other.annotation,
        accent: p.accent.main,
      }
      for (const [name, hex] of Object.entries(others)) {
        expect(deltaE(rejected, toLinear(hex)), `rejected vs ${name}`).toBeGreaterThanOrEqual(25)
      }
    })

    it(`${scheme}: the kinds of change (added, removed, flaky) read at 3:1 and are told apart from each other and from needs-review`, () => {
      const kinds = { added: p.state.added, removed: p.state.removed, flaky: p.state.flaky }
      for (const surface of Object.values(p.surface)) {
        for (const [name, glyph] of Object.entries(kinds)) {
          expect(contrast(glyph, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
      const all = Object.entries({ ...kinds, review: p.state.review })
      for (const [i, [name, hex]] of all.entries()) {
        for (const [otherName, otherHex] of all.slice(i + 1)) {
          expect(
            deltaE(toLinear(hex), toLinear(otherHex)),
            `${name} vs ${otherName}`,
          ).toBeGreaterThanOrEqual(15)
        }
      }
    })

    it(`${scheme}: the rejected and failed glyphs read at 3:1 and their words at 4.5:1 on the panel and chrome`, () => {
      for (const surface of [p.surface.panel, p.surface.chrome, p.surface.raised]) {
        for (const glyph of [p.state.rejected, p.state.failed]) {
          expect(contrast(glyph, surface), `${glyph} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
        for (const text of [p.state.rejectedText, p.state.failedText]) {
          expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${scheme}: the expired and no-baseline glyphs (tertiary and secondary text tones) read at 3:1 and their chip words at 4.5:1 on every surface`, () => {
      for (const surface of surfaces) {
        for (const ink of [p.text.tertiary, p.text.secondary]) {
          expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${scheme}: the uploading glyph (the processing color) reads at 3:1 and the chip word at 4.5:1 on the panel, chrome and raised surfaces`, () => {
      for (const surface of [p.surface.panel, p.surface.chrome, p.surface.raised]) {
        expect(
          contrast(p.state.processing, surface),
          `processing on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
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
