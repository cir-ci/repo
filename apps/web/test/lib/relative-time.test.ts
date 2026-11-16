import { describe, expect, it } from 'vitest'

import { formatAge, formatRelative } from '#lib/relative-time.ts'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

describe('formatRelative', () => {
  it('says "just now" within a minute either way', () => {
    expect(formatRelative(ago(20), NOW)).toBe('just now')
    expect(formatRelative(ago(-20), NOW)).toBe('just now')
  })

  it('uses the largest whole unit', () => {
    expect(formatRelative(ago(3 * 60), NOW)).toBe('3 minutes ago')
    expect(formatRelative(ago(2 * 3600), NOW)).toBe('2 hours ago')
    expect(formatRelative(ago(24 * 3600), NOW)).toBe('yesterday')
    expect(formatRelative(ago(3 * 24 * 3600), NOW)).toBe('3 days ago')
    expect(formatRelative(ago(14 * 24 * 3600), NOW)).toBe('2 weeks ago')
  })

  it('counts forward for a time in the future', () => {
    expect(formatRelative(ago(-5 * 60), NOW)).toBe('in 5 minutes')
  })
})

describe('formatAge', () => {
  it('abbreviates to the largest whole unit, and says "now" under a minute', () => {
    expect(formatAge(ago(20), NOW)).toBe('now')
    expect(formatAge(ago(2 * 60), NOW)).toBe('2m')
    expect(formatAge(ago(3 * 3600), NOW)).toBe('3h')
    expect(formatAge(ago(2 * 86400 + 5), NOW)).toBe('2d')
    expect(formatAge(ago(15 * 86400), NOW)).toBe('2w')
    expect(formatAge(ago(95 * 86400), NOW)).toBe('3mo')
    expect(formatAge(ago(800 * 86400), NOW)).toBe('2y')
    expect(formatAge(ago(-60), NOW)).toBe('now')
  })
})
