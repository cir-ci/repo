/** A minimal standalone HTML page for server-side notices (dashboard off, app not built). */
export function noticePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · CirCI</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#0f172a}code{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px}@media(prefers-color-scheme:dark){body{background:#0b1120;color:#e2e8f0}code{background:#1e293b}}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`
}

/** Paths answered with JSON, never with an HTML page or the app shell. */
export function isApiPath(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/v1/')
}
