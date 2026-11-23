import { describe, expect, it } from 'vitest'

import { detectKind, KINDS } from '#src/kinds.ts'

const files = (...f: string[]) => f

describe('kind detection', () => {
  // Named by what gives each kind away, so every case has its own name (Flakiness.io keys a test's
  // history by its full name).
  it.each([
    {
      kind: 'storybook',
      by: 'index.json',
      list: files('index.html', 'iframe.html', 'index.json', 'sb-manager/runtime.js'),
    },
    {
      kind: 'storybook',
      by: 'stories.json',
      list: files('index.html', 'iframe.html', 'stories.json'),
    },
    {
      kind: 'playwright-report',
      by: 'its trace viewer',
      list: files('index.html', 'data/abc.png', 'trace/index.html', 'trace/sw.bundle.js'),
    },
    {
      kind: 'vitest-report',
      by: 'html.meta.json.gz',
      list: files('index.html', 'html.meta.json.gz', 'data/x.json'),
    },
    { kind: 'coverage', by: 'lcov-report/', list: files('lcov-report/index.html', 'lcov.info') },
    {
      kind: 'coverage',
      by: "Istanbul's prettify.js",
      list: files('index.html', 'base.css', 'prettify.js', 'src/a.ts.html'),
    },
    { kind: 'generic', by: 'an index.html at the root', list: files('index.html', 'app.js') },
    { kind: 'generic', by: 'an index.html in a folder', list: files('docs/index.html') },
  ])('$kind, told by $by', ({ kind, list }) => {
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

  it("knows each kind's entry page", () => {
    expect(KINDS.coverage.entryPath(new Set(['lcov-report/index.html']))).toBe(
      'lcov-report/index.html',
    )
    expect(KINDS.storybook.entryPath(new Set())).toBe('index.html')
  })
})
