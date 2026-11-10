import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isValidSlug, RESERVED_SLUGS } from '#src/index.ts'

const web = join(import.meta.dirname, '../../../apps/web/src')

/** Every `path: '…'` string of the router and the feature route files, read as text. */
function routePaths(): string[] {
  const files = [
    join(web, 'app/router.tsx'),
    ...readdirSync(join(web, 'features')).map((f) => join(web, 'features', f, 'routes.ts')),
  ]
  const paths: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/\bpath:\s*'([^']*)'/g)) paths.push(m[1] ?? '')
  }
  return paths
}

describe('reserved slugs', () => {
  it('reserves every top-level segment the web app routes on', () => {
    const paths = routePaths()
    expect(paths.length).toBeGreaterThan(10)
    const top = new Set(
      paths
        .map((p) => p.replace(/^\//, '').split('/')[0] ?? '')
        .filter((s) => s !== '' && !s.startsWith('$')),
    )
    // The redirect routes are declared from a list (`['reviews', 'insights']`), not a literal.
    for (const page of ['reviews', 'insights']) top.add(page)
    const missing = [...top].filter((s) => !RESERVED_SLUGS.includes(s))
    expect(missing).toEqual([])
  })

  it.each(['inbox', 'account', 'workspaces', 'instance', 'reviews', 'search', 'views'])(
    'refuses %s as a slug',
    (s) => {
      expect(isValidSlug(s)).toBe(false)
    },
  )
})
