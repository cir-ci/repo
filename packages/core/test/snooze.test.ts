import { describe, expect, it } from 'vitest'

import { ValidationError } from '#src/errors.ts'
import { snoozeUntil } from '#src/reviews/index.ts'

const iso = (d: Date | null) => d?.toISOString() ?? null

describe('snoozeUntil', () => {
  it('has no end time until the next push', () => {
    expect(snoozeUntil('next_push', new Date())).toBeNull()
  })

  it('wakes tomorrow at 09:00 UTC, also just before midnight', () => {
    expect(iso(snoozeUntil('tomorrow', new Date('2026-03-10T12:00:00Z')))).toBe(
      '2026-03-11T09:00:00.000Z',
    )
    expect(iso(snoozeUntil('tomorrow', new Date('2026-03-10T23:59:59Z')))).toBe(
      '2026-03-11T09:00:00.000Z',
    )
    expect(iso(snoozeUntil('tomorrow', new Date('2026-12-31T08:00:00Z')))).toBe(
      '2027-01-01T09:00:00.000Z',
    )
  })

  it('wakes next week on the coming Monday at 09:00 UTC, a Monday included', () => {
    // Tuesday
    expect(iso(snoozeUntil('next_week', new Date('2026-03-10T12:00:00Z')))).toBe(
      '2026-03-16T09:00:00.000Z',
    )
    // Monday morning: the Monday after, never today
    expect(iso(snoozeUntil('next_week', new Date('2026-03-09T00:00:00Z')))).toBe(
      '2026-03-16T09:00:00.000Z',
    )
    // Sunday
    expect(iso(snoozeUntil('next_week', new Date('2026-03-15T23:00:00Z')))).toBe(
      '2026-03-16T09:00:00.000Z',
    )
  })

  it('takes a custom date as given, if it is in the future', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    const date = new Date('2026-03-10T12:00:01Z')
    expect(snoozeUntil('date', now, date)).toBe(date)
    expect(() => snoozeUntil('date', now, now)).toThrow(ValidationError)
    expect(() => snoozeUntil('date', now, new Date('2026-03-01T00:00:00Z'))).toThrow(/future/)
    expect(() => snoozeUntil('date', now)).toThrow(ValidationError)
    expect(() => snoozeUntil('date', now, new Date('nope'))).toThrow(ValidationError)
  })
})
