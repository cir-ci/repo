import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { E2E_ROOT } from '#stack/paths.ts'

/**
 * The end-to-end tests run as two groups (vitest projects `e2e-api` and `e2e-browser`, turbo
 * tasks `e2e:api` and `e2e:browser`), told apart by file name. A file that drives Chromium
 * must be named `*.browser.e2e.test.ts` and no other may be: the name decides which cached
 * task runs it.
 */
const testFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith('.e2e.test.ts') ? [path] : []
  })

// Chromium through Playwright (useBrowser, a page), or `pnpm test:visual` (Vitest browser mode).
const DRIVES_BROWSER = /useBrowser\(|launchBrowser\(|from 'playwright'|\.goto\(|test:visual/

describe('e2e groups', () => {
  const files = testFiles(join(E2E_ROOT, 'test'))

  it('finds the end-to-end files', () => {
    expect(files.length).toBeGreaterThan(15)
  })

  it('names exactly the files that drive a browser *.browser.e2e.test.ts', () => {
    const wrong = files.filter(
      (file) =>
        DRIVES_BROWSER.test(readFileSync(file, 'utf8')) !== file.endsWith('.browser.e2e.test.ts'),
    )
    expect(wrong.map((f) => f.slice(E2E_ROOT.length + 1))).toEqual([])
  })
})
