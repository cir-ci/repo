import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { monoFont, sansFont, tokenVariables } from '@circi/ui/theme'

import { LOGO_SVG } from './logo-svg.ts'

const FILE = new URL('./standalone-page.css', import.meta.url)

/**
 * The CSS custom properties the stylesheet defines from the design tokens, for the one scheme:
 * only the `--circi-…` variables it uses (and the ones those refer to), the fonts included.
 */
function tokenBlock(scheme: 'light' | 'dark', used: ReadonlySet<string>, indent: string): string {
  const all: Record<string, string> = {
    ...tokenVariables(scheme),
    '--circi-font-sans': sansFont,
    '--circi-font-mono': monoFont,
  }
  const wanted = new Set(used)
  // A value can point at another variable (`--circi-glow` mixes `--circi-brand-maroon`).
  for (const name of wanted) {
    for (const match of (all[name] ?? '').matchAll(/var\((--circi-[\w-]+)\)/g)) {
      if (match[1] !== undefined) wanted.add(match[1])
    }
  }
  return Object.entries(all)
    .filter(([name]) => wanted.has(name))
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n')
}

/**
 * The page's one stylesheet, inline so a notice needs no request to anything: `standalone-page.css`
 * behind the token variables, light by default and dark under the system preference. Read once at
 * start: from `src/` when Node runs the source, from next to the bundle (tsdown copies it) in the image.
 */
export function buildStyle(css: string = readFileSync(FILE, 'utf8')): string {
  const used = new Set(css.match(/--circi-[\w-]+/g))
  return [
    `:root {\n${tokenBlock('light', used, '  ')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n${tokenBlock('dark', used, '    ')}\n  }\n}`,
    css,
  ].join('\n')
}

const STYLE = buildStyle()

/**
 * The Content-Security-Policy for these pages: nothing may load, and the one inline stylesheet is
 * allowed by its hash (the logo carries presentation attributes only, so no inline style
 * attributes are needed). Safe to send on any response that is a `standalonePage`.
 */
export const PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(STYLE).digest('base64')}'; base-uri 'none'; form-action 'none'`

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A standalone HTML page in the sign-in page's look, with no script and no request: the logo, a
 * title, one line under it and "Self-hosted CirCI" at the foot. `title` is plain text and is
 * escaped; `bodyHtml` is markup the caller wrote (for example `<code>`), never user input.
 */
export function standalonePage(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle} · CirCI</title><style>${STYLE}</style></head><body><main id="content">${LOGO_SVG}<div><h1>${safeTitle}</h1><p>${bodyHtml}</p></div></main><footer>Self-hosted CirCI</footer></body></html>`
}

/** A page for server-side notices (dashboard off, app not built): `body` may hold `<code>`. */
export function noticePage(title: string, body: string): string {
  return standalonePage(title, body)
}

/** Paths answered with JSON, never with an HTML page or the app shell. */
export function isApiPath(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/v1/') || url.startsWith('/v2/')
}
