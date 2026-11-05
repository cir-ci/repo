import { describe, expect, it } from 'vitest'

import {
  branchHash,
  chooseSlug,
  commitHash,
  detectKind,
  KINDS,
  labelOf,
  MAX_SLUG_LENGTH,
  parseLabel,
  pickLabel,
  requestPath,
  safeEntryPath,
  slugify,
  UnsafePathError,
} from '../src/index.ts'

describe('safeEntryPath', () => {
  it('accepts ordinary paths and tidies them', () => {
    expect(safeEntryPath('index.html')).toBe('index.html')
    expect(safeEntryPath('./assets//app.js')).toBe('assets/app.js')
    expect(safeEntryPath('a/./b/c.css')).toBe('a/b/c.css')
  })

  it.each([
    '../etc/passwd',
    'a/../../b',
    'a/..',
    '/etc/passwd',
    'a\\b',
    'nul\0byte',
    '',
    '.',
    './',
    '_circi/nav.js',
    '_circi',
    './_circi/x',
  ])('rejects %j', (raw) => {
    expect(() => safeEntryPath(raw)).toThrow(UnsafePathError)
  })

  it('allows names that merely start like the reserved prefix', () => {
    expect(safeEntryPath('_circi-docs/index.html')).toBe('_circi-docs/index.html')
  })
})

describe('requestPath', () => {
  it('decodes, and refuses to leave the root', () => {
    expect(requestPath('/assets/app%20x.js')).toBe('assets/app x.js')
    expect(requestPath('/')).toBe('')
    expect(requestPath('/a/../b')).toBeUndefined()
    expect(requestPath('/%2e%2e/secret')).toBeUndefined()
    expect(requestPath('/a%5Cb')).toBeUndefined()
    expect(requestPath('/%00')).toBeUndefined()
    expect(requestPath('/%zz')).toBeUndefined()
  })
})

describe('addresses', () => {
  it('hashes commits by prefix and branches by name, always 12 safe characters', () => {
    expect(commitHash('3F9C2AB41D07AABBCCDD')).toBe('3f9c2ab41d07')
    const h = branchHash('feature/Weird Name/ünï')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(branchHash('feature/Weird Name/ünï')).toBe(h)
    expect(branchHash('main')).not.toBe(branchHash('Main'))
  })

  it('chooses slugs: project-name, then with the org, then numbered, never over 46 characters', () => {
    const taken = new Set<string>()
    const input = { project: 'web', name: 'storybook', org: 'acme' }
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook')
    taken.add('web-storybook')
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook-acme')
    taken.add('web-storybook-acme')
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook-acme-2')
    const long = { project: 'p'.repeat(60), name: 'storybook', org: 'acme' }
    const all = new Set<string>()
    for (let i = 0; i < 4; i += 1) {
      const slug = chooseSlug(long, (s) => all.has(s))
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
      expect(slug.endsWith('-')).toBe(false)
      all.add(slug)
    }
    expect(all.size).toBe(4)
  })

  it('slugifies', () => {
    expect(slugify('Web App / Storybook!')).toBe('web-app-storybook')
    expect(slugify('--x--')).toBe('x')
  })

  it('parses addresses and refuses look-alikes', () => {
    expect(parseLabel('3f9c2ab41d07-web-storybook')).toEqual({
      hash: '3f9c2ab41d07',
      slug: 'web-storybook',
    })
    expect(parseLabel('3f9c2ab41d07aabb-web')).toEqual({ hash: '3f9c2ab41d07aabb', slug: 'web' })
    for (const bad of [
      'web-storybook',
      '3F9C2AB41D07-web',
      '3f9c2ab41d07-',
      '3f9c2ab41d07-Web',
      '3f9c2ab41d0-web',
      '3f9c2ab41d07-web.evil',
    ]) {
      expect(parseLabel(bad)).toBeUndefined()
    }
  })

  it('falls back to 16 characters when the short label is taken', () => {
    const taken = new Set(['3f9c2ab41d07-web'])
    expect(pickLabel('3f9c2ab41d07aabb', 'web', (l) => taken.has(l))).toBe('3f9c2ab41d07aabb-web')
    expect(pickLabel('3f9c2ab41d07aabb', 'other', (l) => taken.has(l))).toBe('3f9c2ab41d07-other')
  })

  it('takes the label only from exactly one level under the sites domain', () => {
    const d = 'example-sites.com'
    expect(labelOf('3f9c2ab41d07-web.example-sites.com', d)).toBe('3f9c2ab41d07-web')
    expect(labelOf('3F9C2AB41D07-WEB.EXAMPLE-SITES.COM:8443', d)).toBe('3f9c2ab41d07-web')
    expect(labelOf('example-sites.com', d)).toBeUndefined()
    expect(labelOf('a.b.example-sites.com', d)).toBeUndefined()
    expect(labelOf('x.evil-example-sites.com', d)).toBeUndefined()
    expect(labelOf('x.example-sites.com.evil.io', d)).toBeUndefined()
  })
})

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

describe('commitHash with a SHA of an unexpected case', () => {
  it('is always lowercase', () => {
    expect(commitHash('ABCDEF0123456789')).toBe('abcdef012345')
  })
})
