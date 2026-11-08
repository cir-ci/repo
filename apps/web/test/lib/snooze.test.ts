import { describe, expect, it } from 'vitest'

import { customSnoozeDate, dateInputValue, snoozeOptions } from '#lib/snooze.ts'

describe('snoozeOptions', () => {
  it('offers the four choices in order', () => {
    expect(snoozeOptions(true).map((o) => o.label)).toEqual([
      'Until next push',
      'Tomorrow',
      'Next week',
      'Custom date',
    ])
  })

  it('drops "Until next push" where there is no push', () => {
    expect(snoozeOptions(false).map((o) => o.kind)).toEqual(['tomorrow', 'next_week', 'date'])
  })
})

describe('customSnoozeDate', () => {
  const now = new Date(2026, 10, 8, 14, 0)

  it('wakes at 9:00 local on a future day', () => {
    const iso = customSnoozeDate('2026-11-10', now)
    expect(iso).toBeDefined()
    const date = new Date(iso ?? '')
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 10, 10, 9,
    ])
  })

  it('refuses the past, today after 9:00, and what is not a date', () => {
    expect(customSnoozeDate('2026-11-01', now)).toBeUndefined()
    expect(customSnoozeDate('2026-11-08', now)).toBeUndefined()
    expect(customSnoozeDate('2026-02-31', now)).toBeUndefined()
    expect(customSnoozeDate('soon', now)).toBeUndefined()
    expect(customSnoozeDate('', now)).toBeUndefined()
  })

  it('writes a date input value', () => {
    expect(dateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
