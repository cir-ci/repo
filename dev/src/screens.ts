import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import sharp from 'sharp'

/** A made-up page, drawn as blocks (no text, so no fonts are needed): enough to see diffs. */
export interface Screen {
  /** Screenshot name, e.g. `settings/profile` (written as `settings/profile.png`). */
  name: string
  accent: string
  /** Width of the left navigation, 0 for none. */
  sidebar?: number
  /** Content cards: how many, and how many per row. */
  cards: number
  columns?: number
  /** Where the primary button sits, from the left of the content area. */
  buttonX?: number
  /** A banner across the top of the content. */
  banner?: string
  /** Page size when it is not the usual 960 by 600 (a size change shows in the diff). */
  width?: number
  height?: number
  /** A dark strip along the bottom covering this share of the page: that share is the diff score. */
  band?: number
  /** The page background, when it is not the light grey (a large change). */
  background?: string
  /** A "clock" in the header, a few blocks wide: something an ignore region can hide. */
  clock?: number
  /** Written as bytes that are not a PNG, so the pipeline reports the screenshot as unreadable. */
  broken?: boolean
}

const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 600
const HEADER = 56

function svg(screen: Screen): string {
  const WIDTH = screen.width ?? DEFAULT_WIDTH
  const HEIGHT = screen.height ?? DEFAULT_HEIGHT
  const sidebar = screen.sidebar ?? 0
  const columns = screen.columns ?? 3
  const left = sidebar + 32
  const contentWidth = WIDTH - left - 32
  const gap = 16
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns
  let top = HEADER + 32
  const parts: string[] = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${screen.background ?? '#f6f7f9'}"/>`,
    `<rect width="${WIDTH}" height="${HEADER}" fill="${screen.accent}"/>`,
    `<rect x="24" y="18" width="120" height="20" rx="4" fill="#ffffff" opacity="0.85"/>`,
    `<circle cx="${WIDTH - 40}" cy="28" r="14" fill="#ffffff" opacity="0.85"/>`,
  ]
  if (screen.clock) {
    parts.push(
      `<rect x="700" y="18" width="${40 + screen.clock * 12}" height="20" rx="4" fill="#ffffff" opacity="0.85"/>`,
    )
  }
  if (sidebar > 0) {
    parts.push(
      `<rect y="${HEADER}" width="${sidebar}" height="${HEIGHT - HEADER}" fill="#e6e8ec"/>`,
    )
    for (let i = 0; i < 6; i++) {
      parts.push(
        `<rect x="20" y="${HEADER + 24 + i * 36}" width="${sidebar - 40}" height="14" rx="3" fill="#c3c7cf"/>`,
      )
    }
  }
  if (screen.banner) {
    parts.push(
      `<rect x="${left}" y="${top}" width="${contentWidth}" height="44" rx="6" fill="${screen.banner}"/>`,
    )
    top += 60
  }
  parts.push(`<rect x="${left}" y="${top}" width="260" height="22" rx="4" fill="#2b2f36"/>`)
  parts.push(
    `<rect x="${left + (screen.buttonX ?? contentWidth - 120)}" y="${top - 4}" width="120" height="32" rx="6" fill="${screen.accent}"/>`,
  )
  top += 48
  for (let i = 0; i < screen.cards; i++) {
    const x = left + (i % columns) * (cardWidth + gap)
    const y = top + Math.floor(i / columns) * 156
    parts.push(
      `<rect x="${x}" y="${y}" width="${cardWidth}" height="140" rx="8" fill="#ffffff" stroke="#dde0e5"/>`,
      `<rect x="${x + 16}" y="${y + 16}" width="${cardWidth * 0.5}" height="12" rx="3" fill="#9aa0aa"/>`,
      `<rect x="${x + 16}" y="${y + 40}" width="${cardWidth - 32}" height="8" rx="3" fill="#d4d7dd"/>`,
      `<rect x="${x + 16}" y="${y + 56}" width="${cardWidth - 64}" height="8" rx="3" fill="#d4d7dd"/>`,
      `<rect x="${x + 16}" y="${y + 100}" width="64" height="20" rx="4" fill="${screen.accent}" opacity="0.25"/>`,
    )
  }
  if (screen.band) {
    const h = Math.max(1, Math.round(screen.band * HEIGHT))
    parts.push(`<rect y="${HEIGHT - h}" width="${WIDTH}" height="${h}" fill="#1d2433"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`
}

/** Each distinct screen is drawn once, however many builds use it. */
const rendered = new Map<string, Promise<Buffer>>()

function render(screen: Screen): Promise<Buffer> {
  if (screen.broken) return Promise.resolve(Buffer.from('this is not a png, just some text'))
  const key = JSON.stringify(screen)
  let png = rendered.get(key)
  if (!png) {
    png = sharp(Buffer.from(svg(screen)))
      .png()
      .toBuffer()
    rendered.set(key, png)
  }
  return png
}

/** Writes each screen as `<dir>/<name>.png`. */
export async function writeScreens(dir: string, screens: Screen[]): Promise<void> {
  await Promise.all(
    screens.map(async (screen) => {
      const file = join(dir, `${screen.name}.png`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, await render(screen))
    }),
  )
}

export const BLUE = '#3355dd'

/** The default branch's screens: the baseline every pull request is compared with. */
export const BASELINE: Screen[] = [
  { name: 'home', accent: BLUE, cards: 6 },
  { name: 'login', accent: BLUE, cards: 1, columns: 1, buttonX: 0 },
  { name: 'pricing', accent: BLUE, cards: 3 },
  { name: 'dashboard/overview', accent: BLUE, sidebar: 200, cards: 4, columns: 2 },
  { name: 'settings/profile', accent: BLUE, sidebar: 200, cards: 2, columns: 1 },
  { name: 'settings/billing', accent: BLUE, sidebar: 200, cards: 3, columns: 1 },
]

/** Pages called `names`, drawn in one accent, each a little different from the next. */
export function pagesOf(accentColor: string, names: string[]): Screen[] {
  return names.map((name, i) => ({
    name,
    accent: accentColor,
    cards: 1 + ((i * 2) % 6),
    columns: 1 + ((i + 1) % 3),
    ...(i % 3 === 2 ? { sidebar: 200 } : {}),
  }))
}

/** A named build in the web app that has nothing to compare with yet, so Triage lists "No baseline". */
export const STORYBOOK: Screen[] = [
  { name: 'storybook/button', accent: '#ef476f', cards: 3 },
  { name: 'storybook/card', accent: '#ef476f', cards: 2, columns: 2 },
  { name: 'storybook/modal', accent: '#ef476f', cards: 1, columns: 1, banner: '#118ab2' },
]

/** What a commit does to the pages. */
export type Change = (screens: Screen[]) => Screen[]

const on =
  (name: string, patch: (s: Screen) => Screen): Change =>
  (screens) =>
    screens.map((s) => (s.name === name ? patch(s) : s))

/** No visible change. */
export const same: Change = (screens) => screens

/** A banner across the page; `undefined` takes it away again. */
export const banner = (name: string, color: string | undefined): Change =>
  on(name, (s) => {
    const { banner: _old, ...rest } = s
    return color ? { ...rest, banner: color } : rest
  })

/** The primary button sits at the left (`true`) or at the right again. */
export const buttonLeft = (name: string, left: boolean): Change =>
  on(name, (s) => {
    const { buttonX: _old, ...rest } = s
    return left ? { ...rest, buttonX: 0 } : rest
  })

export const accent = (name: string, color: string): Change =>
  on(name, (s) => ({ ...s, accent: color }))

export const cards = (name: string, count: number, columns?: number): Change =>
  on(name, (s) => ({ ...s, cards: count, ...(columns ? { columns } : {}) }))

/** A page that wasn't there before. */
export const addPage =
  (screen: Screen): Change =>
  (screens) => [...screens.filter((s) => s.name !== screen.name), screen]

export const removePage =
  (name: string): Change =>
  (screens) =>
    screens.filter((s) => s.name !== name)

/** Several changes, one after the other. */
export const together =
  (...changes: Change[]): Change =>
  (screens) =>
    changes.reduce((current, change) => change(current), screens)

/** A dark strip over this share of the page: a Small (up to .1), Medium (.15 to .3) or bigger diff. */
export const band = (name: string, share: number | undefined): Change =>
  on(name, (s) => {
    const { band: _old, ...rest } = s
    return share ? { ...rest, band: share } : rest
  })

/** A new page background: nearly every pixel changes, a Large diff. */
export const background = (name: string, color: string | undefined): Change =>
  on(name, (s) => {
    const { background: _old, ...rest } = s
    return color ? { ...rest, background: color } : rest
  })

/** The page gets another size (a "size changed" diff). */
export const resize = (name: string, width: number, height: number): Change =>
  on(name, (s) => ({ ...s, width, height }))

/** The header clock shows another time. */
export const tick = (name: string, clock: number): Change => on(name, (s) => ({ ...s, clock }))

/** The page's screenshot is not a readable PNG. */
export const broken = (name: string): Change => on(name, (s) => ({ ...s, broken: true }))

/** `count` pages called `<prefix>/<n>`, each a little different: for a build with a lot of screenshots. */
export function gallery(prefix: string, count: number, accentColor: string): Screen[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}/${String(i + 1).padStart(3, '0')}`,
    accent: accentColor,
    cards: 1 + (i % 6),
    columns: 1 + (i % 3),
    ...(i % 4 === 0 ? { sidebar: 200 } : {}),
  }))
}
