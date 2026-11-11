import { describe, expect, it } from 'vitest'

import {
  generalDirty,
  pictureProblem,
  generalPatch,
  generalProblems,
  inheritance,
  slugConfirmed,
  retentionDirty,
  retentionProblem,
  validateDomain,
  validateSso,
} from '#features/workspace-settings/model.ts'

describe('generalProblems', () => {
  it('accepts a name and a valid address', () => {
    expect(generalProblems({ name: 'Acme', slug: 'acme-co' })).toEqual({})
  })
  it('asks for both', () => {
    expect(generalProblems({ name: '  ', slug: '' })).toEqual({
      name: 'Enter a name',
      slug: 'Enter an address',
    })
  })
  it.each(['Acme', 'a b', '-a', 'a-', 'a--b', 'api', 'x'.repeat(41)])(
    'refuses the address %j',
    (slug) => {
      expect(generalProblems({ name: 'Acme', slug }).slug).toMatch(/lowercase letters|Enter/)
    },
  )
  it('refuses a name over 100 characters', () => {
    expect(generalProblems({ name: 'x'.repeat(101), slug: 'a' }).name).toMatch(/at most 100/)
  })
})

describe('general edits', () => {
  const saved = { name: 'Acme', slug: 'acme' }
  it('is dirty only when something changed (a trimmed name is the same name)', () => {
    expect(generalDirty(saved, { name: ' Acme ', slug: 'acme' })).toBe(false)
    expect(generalDirty(saved, { name: 'Acme', slug: 'acme2' })).toBe(true)
  })
  it('sends only what changed', () => {
    expect(generalPatch(saved, { name: 'Acme Inc', slug: 'acme' })).toEqual({ name: 'Acme Inc' })
    expect(generalPatch(saved, { name: 'Acme', slug: 'acme2' })).toEqual({ slug: 'acme2' })
    expect(generalPatch(saved, { name: 'B', slug: 'b' })).toEqual({ name: 'B', slug: 'b' })
  })
})

describe('retention', () => {
  it.each(['', '0', '-1', '1.5', 'abc', '9 0'])('refuses %j', (text) => {
    expect(retentionProblem(text)).toMatch(/whole number of days/)
  })
  it('accepts whole days', () => {
    expect(retentionProblem('90')).toBeNull()
    expect(retentionProblem(' 7 ')).toBeNull()
  })
  it('compares with the saved value', () => {
    expect(retentionDirty(90, '90')).toBe(false)
    expect(retentionDirty(90, ' 90 ')).toBe(false)
    expect(retentionDirty(90, '30')).toBe(true)
  })
})

describe('validateDomain', () => {
  it('asks for a domain', () => {
    expect(validateDomain('').domain).toMatch(/Enter a domain/)
  })
  it.each(['example', 'https://example.com', 'a@example.com', 'example.com/x'])(
    'refuses %j',
    (domain) => {
      expect(validateDomain(domain).domain).toMatch(/just the domain/)
    },
  )
  it('accepts a domain', () => {
    expect(validateDomain('example.com')).toEqual({})
    expect(validateDomain('mail.example.co.uk')).toEqual({})
  })
})

describe('validateSso', () => {
  const ok = { issuer: 'https://login.example.com', clientId: 'id', clientSecret: 's3cret' }
  it('accepts a complete form', () => {
    expect(validateSso(ok)).toEqual({})
  })
  it('names every empty field', () => {
    expect(validateSso({ issuer: '', clientId: '', clientSecret: '' })).toEqual({
      issuer: 'Enter the issuer address',
      clientId: 'Enter the client ID',
      clientSecret: 'Enter the client secret',
    })
  })
  it('wants a full web address for the issuer', () => {
    expect(validateSso({ ...ok, issuer: 'login.example.com' }).issuer).toMatch(/full address/)
    expect(validateSso({ ...ok, issuer: 'ftp://login.example.com' }).issuer).toMatch(/full address/)
    expect(validateSso({ ...ok, issuer: 'http://localhost:8080' })).toEqual({})
  })
})

describe('slugConfirmed', () => {
  it('needs the address exactly (spaces around it are fine, case is not)', () => {
    expect(slugConfirmed('acme-inc', 'acme-inc')).toBe(true)
    expect(slugConfirmed('  acme-inc ', 'acme-inc')).toBe(true)
    expect(slugConfirmed('Acme-Inc', 'acme-inc')).toBe(false)
    expect(slugConfirmed('Acme Inc', 'acme-inc')).toBe(false)
    expect(slugConfirmed('', '')).toBe(false)
  })
})

describe('inheritance', () => {
  it('splits the projects that follow the default from the ones that override it, with their value', () => {
    const web = { name: 'Web', flakyBlocksMerge: null }
    const docs = { name: 'Docs', flakyBlocksMerge: null }
    const marketing = { name: 'marketing-site', flakyBlocksMerge: false }
    expect(inheritance([web, docs, marketing])).toEqual({
      inheriting: [web, docs],
      overriding: [{ ...marketing, value: 'off' }],
    })
  })
  it('reads the triage field when asked', () => {
    const project = { name: 'Web', flakyBlocksMerge: null, assignTriageToOnCall: true }
    expect(inheritance([project], 'assignTriageToOnCall')).toEqual({
      inheriting: [],
      overriding: [{ ...project, value: 'on' }],
    })
  })
  it('has no overrides when every project follows the default', () => {
    const web = { name: 'Web', flakyBlocksMerge: null }
    expect(inheritance([web])).toEqual({ inheriting: [web], overriding: [] })
  })
})

describe('pictureProblem', () => {
  it('accepts PNG, JPEG and WebP up to 1 MB and says what is wrong otherwise', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(pictureProblem({ type, size: 1024 * 1024 })).toBeNull()
    }
    expect(pictureProblem({ type: 'image/gif', size: 10 })).toBe('Use a PNG, JPEG or WebP image')
    expect(pictureProblem({ type: 'image/png', size: 1024 * 1024 + 1 })).toBe(
      'Use an image of at most 1 MB',
    )
  })
})
