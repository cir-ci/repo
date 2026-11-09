import { createHash } from 'node:crypto'

import { LOGO_SVG } from './logo-svg.ts'

/**
 * The page's one stylesheet, inline so a notice needs no request to anything. The values are the
 * design tokens (packages/ui/src/theme.ts): light by default, dark under the system preference.
 * It is the sign-in page's look: the glow ground, a 360px column, the 56px logo with its ring.
 */
const STYLE = `
:root{--bg:#f3efed;--raised:#fff;--text:#1f1a18;--text2:#5e5450;--text3:#6f6560;--line:rgba(28,15,12,.08);--maroon:#724039;--blush:#e4b1a7;--glow:color-mix(in srgb,var(--maroon) 14%,transparent)}
@media(prefers-color-scheme:dark){:root{--bg:#0c0a09;--raised:#1a1716;--text:#ede6e3;--text2:#a89d98;--text3:#998e89;--line:rgba(255,255,255,.07);--glow:color-mix(in srgb,var(--maroon) 55%,transparent)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 16px;background:radial-gradient(800px 480px at 50% -10%,var(--glow),transparent 70%),var(--bg);color:var(--text);font:400 13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:360px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
.logo{display:block;width:56px;height:56px;border-radius:12px;box-shadow:0 0 0 1px var(--blush),0 0 0 5px color-mix(in srgb,var(--maroon) 50%,transparent)}
h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
p{margin:4px 0 0;color:var(--text2)}
code{font:400 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:1px 6px;border-radius:4px;border:1px solid var(--line);background:var(--raised);color:var(--text)}
footer{margin:56px 0 0;color:var(--text3);font-size:12px}
`

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
