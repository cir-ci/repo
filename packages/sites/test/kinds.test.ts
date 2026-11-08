import { describe, expect, it } from 'vitest'

import { detectKind, KINDS } from '#src/kinds.ts'

const files = (...f: string[]) => f

describe('kind detection', () => {
  it.each([
    ['storybook', files('index.html', 'iframe.html', 'index.json', 'sb-manager/runtime.js')],
    ['storybook', files('index.html', 'iframe.html', 'stories.json')],
    [
      'playwright-report',
      files('index.html', 'data/abc.png', 'trace/index.html', 'trace/sw.bundle.js'),
    ],
    ['vitest-report', files('index.html', 'html.meta.json.gz', 'data/x.json')],
    ['coverage', files('lcov-report/index.html', 'lcov.info')],
    ['coverage', files('index.html', 'base.css', 'prettify.js', 'src/a.ts.html')],
    ['generic', files('index.html', 'app.js')],
    ['generic', files('docs/index.html')],
  ])('%s', (kind, list) => {
    expect(detectKind(list).id).toBe(kind)
  })

  it('never auto-detects docs, and only Playwright reports may run a service worker', () => {
    expect(KINDS.docs.detect(new Set(['index.html']))).toBe(false)
    expect(
      Object.values(KINDS)
        .filter((k) => k.serviceWorker)
        .map((k) => k.id),
    ).toEqual(['playwright-report'])
  })

  it('knows each kind’s entry page', () => {
    expect(KINDS.coverage.entryPath(new Set(['lcov-report/index.html']))).toBe(
      'lcov-report/index.html',
    )
    expect(KINDS.storybook.entryPath(new Set())).toBe('index.html')
  })
})
