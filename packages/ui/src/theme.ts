/**
 * The CirCI palettes, one per colour scheme. Brand tones come from the logo and are the same in
 * both; neutrals carry the logo's hue at very low chroma so greys read warm. State colours are the
 * accent's complement (teal) and its triad (amber, periwinkle), and they differ in lightness as
 * well as hue. In light, accent and state colours are darkened so text in them keeps 4.5:1 on
 * every surface (`test/theme.test.ts` checks this).
 */
const brand = {
  maroon: '#724039',
  blush: '#e4b1a7',
  rosewood: '#d49689',
  salmon: '#d48677',
  terracotta: '#b96e5f',
}

const dark = {
  brand,
  /** Elevation, dimmest to highest. `chrome` is the sidebar and page ground; `panel` the content. */
  surface: {
    chrome: '#0c0a09',
    panel: '#131110',
    raised: '#1a1716',
    overlay: '#221e1d',
    highest: '#2b2625',
  },
  text: { primary: '#ede6e3', secondary: '#a89d98', tertiary: '#998e89' },
  accent: {
    main: '#d9806d',
    text: '#eaa493',
    onAccent: '#1c0f0c',
    hover: '#f3c2b6',
    /** Fill behind a selected row. */
    subtle: 'rgba(217, 128, 109, 0.12)',
  },
  /** `reviewText` is `review` for text: in light the glyph amber is too pale to read as words. */
  state: {
    approved: '#5cb8a8',
    review: '#eec84f',
    reviewText: '#eec84f',
    processing: '#9aa3f7',
    /** A build, screenshot or job that broke (and errors): crimson, a cross. */
    failed: '#ff0a1f',
    /**
     * Failed for large fills (bars, stacked segments): `failed` mixed 60% into the raised
     * surface. The full crimson stays for glyphs and words; a fill is read through its tooltip
     * and table view, so it is not held to 3:1.
     */
    failedFill: '#a30f1b',
    /** A person's decision to reject: rose, a disc with one bar. Never crimson, which is failure. */
    rejected: '#ff5fa8',
    /**
     * The kinds of change, told apart by colour as well as by their inner mark: added a
     * yellow-green, removed a burnt orange, flaky an orchid (noticeable, and away from the amber of
     * needs-review). Glyphs only: their words keep the text colours.
     */
    added: '#b1d038',
    removed: '#ef8e32',
    flaky: '#f9b5fe',
    /** Badge and chip words: in light the glyph colours are too pale to read as words. */
    approvedText: '#5cb8a8',
    failedText: '#ff6a75',
    rejectedText: '#ff72b2',
  },
  /** Project identity colours (never state): a project's tile background, with `tile-text` on top. */
  project: {
    slate: '#5d80a8',
    olive: '#768441',
    plum: '#a369a3',
    moss: '#54895b',
    mauve: '#a86b85',
    graphite: '#837c76',
  },
  line: { subtle: 'rgba(255, 255, 255, 0.07)', strong: 'rgba(255, 255, 255, 0.12)' },
  action: { hover: 'rgba(255, 255, 255, 0.045)', selected: 'rgba(255, 255, 255, 0.075)' },
  /** Tokens with no group: emitted as `--circi-<key>` (the canvas names them this way). */
  other: {
    annotation: '#8b46ff',
    annotationText: '#ffffff',
    avatarText: '#e4b1a7',
    /** Letter or icon on a project tile. */
    tileText: '#0c0a09',
    glow: 'color-mix(in srgb, var(--circi-brand-maroon) 55%, transparent)',
    scrim: 'rgba(0, 0, 0, 0.5)',
    shadowPopup: 'none',
    /** The canvas's own backdrop, behind the artboards. */
    stage: '#0f0d0c',
  },
}

const light: typeof dark = {
  brand,
  /** In light the chrome is the dimmest (a warm grey) and the panel lifts to near-white. */
  surface: {
    chrome: '#e9e2de',
    panel: '#fefdfc',
    raised: '#ffffff',
    overlay: '#ffffff',
    highest: '#dcd3ce',
  },
  text: { primary: '#1c1614', secondary: '#51463f', tertiary: '#63574f' },
  accent: {
    main: '#a63f27',
    text: '#8e3420',
    onAccent: '#ffffff',
    hover: '#6f2615',
    subtle: 'rgba(166, 63, 39, 0.10)',
  },
  state: {
    approved: '#0f7a68',
    review: '#946f00',
    reviewText: '#654600',
    processing: '#323eb0',
    failed: '#8f0026',
    failedFill: '#bc667d',
    rejected: '#b00f66',
    added: '#6c7300',
    removed: '#a85a00',
    flaky: '#b04ea7',
    approvedText: '#095a4b',
    failedText: '#8f0026',
    rejectedText: '#8f0a52',
  },
  project: {
    slate: '#4a6d96',
    olive: '#66733a',
    plum: '#8f5490',
    moss: '#46784d',
    mauve: '#a05e79',
    graphite: '#6c665f',
  },
  line: { subtle: 'rgba(28, 15, 12, 0.10)', strong: 'rgba(28, 15, 12, 0.18)' },
  action: { hover: 'rgba(28, 15, 12, 0.05)', selected: 'rgba(28, 15, 12, 0.085)' },
  other: {
    annotation: '#8b46ff',
    annotationText: '#ffffff',
    avatarText: '#51463f',
    tileText: '#ffffff',
    glow: 'color-mix(in srgb, var(--circi-brand-maroon) 14%, transparent)',
    scrim: 'rgba(0, 0, 0, 0.3)',
    shadowPopup: '0 8px 24px rgba(28, 15, 12, 0.14)',
    stage: '#dcd3ce',
  },
}

export type ColorScheme = 'light' | 'dark'
export type Palette = typeof dark

/** The raw colours of each scheme. Prefer `tokens`; use these only where a CSS variable can't go (canvas, previews of the palette). */
export const palettes: Record<ColorScheme, Palette> = { dark, light }

/** The attribute on `<html>` that names the active scheme: `data-circi-color-scheme="light"`. */
export const COLOR_SCHEME_ATTRIBUTE = 'data-circi-color-scheme'

/**
 * The localStorage key holding the viewer's choice (`light`, `dark` or `system`). The web app's
 * `index.html` reads it before the first paint so a light-mode viewer never sees a dark flash.
 */
export const MODE_STORAGE_KEY = 'circi-color-mode'

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
/** The group `other` has no prefix: `other.scrim` is `--circi-scrim`. */
const varName = (group: string, key: string) =>
  group === 'other' ? `--circi-${kebab(key)}` : `--circi-${group}-${kebab(key)}`

type Tokens = { readonly [G in keyof Palette]: { readonly [K in keyof Palette[G]]: string } }

/**
 * The design tokens as CSS variables (`var(--circi-surface-panel)`), so one inline style follows
 * the active colour scheme. `global.css` defines the variables (generated from `tokenVariables`).
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built from `dark`'s own keys just above
export const tokens = Object.fromEntries(
  Object.entries(dark).map(([group, values]) => [
    group,
    Object.fromEntries(Object.keys(values).map((key) => [key, `var(${varName(group, key)})`])),
  ]),
) as unknown as Tokens

/** The variable declarations for one scheme, e.g. `{ '--circi-surface-panel': '#131110', … }`. */
export function tokenVariables(scheme: ColorScheme): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [group, values] of Object.entries(palettes[scheme])) {
    for (const [key, value] of Object.entries(values)) out[varName(group, key)] = value
  }
  return out
}

export const sansFont =
  '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'

/** For SHAs, branch names and anything the reader may copy. */
export const monoFont =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

/** For text that screen readers need but sighted users don't. */
export const visuallyHidden = {
  position: 'absolute',
  // Pinned to its containing block's corner: left at its place in the flow, a label far down a
  // scrolled list would stretch whatever scrolls around that block (the panel, or the window).
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const
