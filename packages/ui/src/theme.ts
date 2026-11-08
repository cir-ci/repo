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
    rejected: '#ff0a1f',
  },
  line: { subtle: 'rgba(255, 255, 255, 0.07)', strong: 'rgba(255, 255, 255, 0.12)' },
  action: { hover: 'rgba(255, 255, 255, 0.045)', selected: 'rgba(255, 255, 255, 0.075)' },
  /** Tokens with no group: emitted as `--circi-<key>` (the canvas names them this way). */
  other: {
    annotation: '#8b46ff',
    annotationText: '#ffffff',
    avatarText: '#e4b1a7',
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
    chrome: '#f3efed',
    panel: '#fcfbfa',
    raised: '#ffffff',
    overlay: '#ffffff',
    highest: '#ebe5e2',
  },
  text: { primary: '#1f1a18', secondary: '#5e5450', tertiary: '#6f6560' },
  accent: {
    main: '#b4573f',
    text: '#9c4a35',
    onAccent: '#ffffff',
    hover: '#7d3a29',
    subtle: 'rgba(180, 87, 63, 0.10)',
  },
  state: {
    approved: '#17806f',
    review: '#b38d05',
    reviewText: '#6b4c00',
    processing: '#4f5bd5',
    rejected: '#930028',
  },
  line: { subtle: 'rgba(28, 15, 12, 0.08)', strong: 'rgba(28, 15, 12, 0.15)' },
  action: { hover: 'rgba(28, 15, 12, 0.04)', selected: 'rgba(28, 15, 12, 0.07)' },
  other: {
    annotation: '#8b46ff',
    annotationText: '#ffffff',
    avatarText: '#5e5450',
    glow: 'color-mix(in srgb, var(--circi-brand-maroon) 14%, transparent)',
    scrim: 'rgba(0, 0, 0, 0.3)',
    shadowPopup: '0 8px 24px rgba(28, 15, 12, 0.14)',
    stage: '#ebe5e2',
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
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const
