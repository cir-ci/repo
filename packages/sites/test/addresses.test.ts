import { describe, expect, it } from 'vitest'

import {
  branchHash,
  chooseSlug,
  commitHash,
  labelOf,
  MAX_SLUG_LENGTH,
  parseLabel,
  pickLabel,
  siteSlug,
} from '#src/addresses.ts'

describe('addresses', () => {
  it('hashes commits by prefix and branches by name, always 12 safe characters', () => {
    expect(commitHash('3F9C2AB41D07AABBCCDD')).toBe('3f9c2ab41d07')
    const h = branchHash('feature/Weird Name/ünï')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(branchHash('feature/Weird Name/ünï')).toBe(h)
    expect(branchHash('main')).not.toBe(branchHash('Main'))
  })

  it('chooses slugs: team-name, then with the workspace, then numbered, never over 46 characters', () => {
    const taken = new Set<string>()
    const input = { team: 'web', name: 'storybook', workspace: 'acme' }
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook')
    taken.add('web-storybook')
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook-acme')
    taken.add('web-storybook-acme')
    expect(chooseSlug(input, (s) => taken.has(s))).toBe('web-storybook-acme-2')
    const long = { team: 'p'.repeat(60), name: 'storybook', workspace: 'acme' }
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
    expect(siteSlug('Web App / Storybook!')).toBe('web-app-storybook')
    expect(siteSlug('--x--')).toBe('x')
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

describe('commitHash with a SHA of an unexpected case', () => {
  it('is always lowercase', () => {
    expect(commitHash('ABCDEF0123456789')).toBe('abcdef012345')
  })
})
