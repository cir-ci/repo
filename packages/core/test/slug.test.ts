import { describe, expect, it } from 'vitest'
import { assertValidSlug, isValidSlug, slugify, ValidationError } from '../src/index.ts'

describe('slugs', () => {
  it.each(['acme', 'web-app', 'a', 'a1', 'x'.repeat(40)])('accepts %s', (s) => {
    expect(isValidSlug(s)).toBe(true)
  })

  it.each(['', '-a', 'a-', 'A', 'a_b', 'a--b', 'x'.repeat(41), 'admin', 'api', 'v1'])(
    'rejects %j',
    (s) => {
      expect(isValidSlug(s)).toBe(false)
    },
  )

  it('throws a ValidationError that says when a name is reserved', () => {
    expect(() => assertValidSlug('settings', 'org slug')).toThrow(ValidationError)
    expect(() => assertValidSlug('settings', 'org slug')).toThrow(/reserved/)
  })

  it('slugifies display names', () => {
    expect(slugify('Acme Inc.')).toBe('acme-inc')
    expect(slugify('  Café  Crème  ')).toBe('cafe-creme')
    expect(slugify('Web__App!!')).toBe('web-app')
    expect(slugify(`${'x'.repeat(39)} y`)).toBe('x'.repeat(39))
  })
})
