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
}

const WIDTH = 960
const HEIGHT = 600
const HEADER = 56

function svg(screen: Screen): string {
  const sidebar = screen.sidebar ?? 0
  const columns = screen.columns ?? 3
  const left = sidebar + 32
  const contentWidth = WIDTH - left - 32
  const gap = 16
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns
  let top = HEADER + 32
  const parts: string[] = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f7f9"/>`,
    `<rect width="${WIDTH}" height="${HEADER}" fill="${screen.accent}"/>`,
    `<rect x="24" y="18" width="120" height="20" rx="4" fill="#ffffff" opacity="0.85"/>`,
    `<circle cx="${WIDTH - 40}" cy="28" r="14" fill="#ffffff" opacity="0.85"/>`,
  ]
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`
}

/** Writes each screen as `<dir>/<name>.png`. */
export async function writeScreens(dir: string, screens: Screen[]): Promise<void> {
  await Promise.all(
    screens.map(async (screen) => {
      const file = join(dir, `${screen.name}.png`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(
        file,
        await sharp(Buffer.from(svg(screen)))
          .png()
          .toBuffer(),
      )
    }),
  )
}

const BLUE = '#3355dd'

/** The default branch's screens: the baseline every pull request is compared with. */
export const BASELINE: Screen[] = [
  { name: 'home', accent: BLUE, cards: 6 },
  { name: 'login', accent: BLUE, cards: 1, columns: 1, buttonX: 0 },
  { name: 'pricing', accent: BLUE, cards: 3 },
  { name: 'dashboard/overview', accent: BLUE, sidebar: 200, cards: 4, columns: 2 },
  { name: 'settings/profile', accent: BLUE, sidebar: 200, cards: 2, columns: 1 },
  { name: 'settings/billing', accent: BLUE, sidebar: 200, cards: 3, columns: 1 },
]

/** A pull request with every kind of change: changed, added, removed and unchanged screens. */
export const REDESIGN: Screen[] = [
  { name: 'home', accent: '#7a3ddb', cards: 6 },
  { name: 'pricing', accent: BLUE, cards: 4, columns: 4 },
  { name: 'dashboard/overview', accent: BLUE, sidebar: 200, cards: 4, columns: 2 },
  { name: 'settings/profile', accent: BLUE, sidebar: 200, cards: 2, columns: 1, buttonX: 0 },
  { name: 'settings/billing', accent: BLUE, sidebar: 200, cards: 3, columns: 1 },
  { name: 'onboarding/welcome', accent: BLUE, cards: 2, columns: 2, banner: '#ffd166' },
]

/** A pull request that changes nothing visible: passes without review. */
export const NO_CHANGES: Screen[] = BASELINE

/** A pull request with one small change, which gets rejected in the seed. */
export const BANNER: Screen[] = BASELINE.map((s) =>
  s.name === 'dashboard/overview' ? Object.assign({}, s, { banner: '#ef476f' }) : s,
)

/**
 * Five builds on main where two screens keep changing back and forth (a dashboard banner that comes
 * and goes, a billing page whose button jumps sides): each keeps returning to an image it already had, so Triage lists them as flaky.
 */
export const FLAKY_RUNS: Screen[][] = [0, 1, 2, 3, 4].map((run) =>
  BASELINE.map((s) => {
    if (s.name === 'dashboard/overview') {
      return run % 2 === 0 ? Object.assign({}, s, { banner: '#06d6a0' }) : s
    }
    if (s.name === 'settings/billing')
      return run % 2 === 0 ? Object.assign({}, s, { buttonX: 0 }) : s
    return s
  }),
)

/** A first Storybook build on main: nothing to compare with yet, so Triage lists "No baseline". */
export const STORYBOOK: Screen[] = [
  { name: 'storybook/button', accent: '#ef476f', cards: 3 },
  { name: 'storybook/card', accent: '#ef476f', cards: 2, columns: 2 },
  { name: 'storybook/modal', accent: '#ef476f', cards: 1, columns: 1, banner: '#118ab2' },
]
