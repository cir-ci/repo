import { describe, expect, it } from 'vitest'

import { rotationFor, rotationHandover } from '../src/rotation.ts'

const members = ['ann', 'bob', 'cy']
// 2026-03-09 is a Monday.
const startsOn = new Date('2026-03-11T15:00:00Z')

describe('rotationFor', () => {
  it('starts with the first member in the week that holds the start date', () => {
    expect(rotationFor(new Date('2026-03-09T00:00:00Z'), members, startsOn)).toBe('ann')
    expect(rotationFor(startsOn, members, startsOn)).toBe('ann')
  })

  it('changes on Monday 00:00 UTC, not before', () => {
    expect(rotationFor(new Date('2026-03-15T23:59:59.999Z'), members, startsOn)).toBe('ann')
    expect(rotationFor(new Date('2026-03-16T00:00:00Z'), members, startsOn)).toBe('bob')
    expect(rotationFor(new Date('2026-03-23T00:00:00Z'), members, startsOn)).toBe('cy')
  })

  it('wraps around after the last member', () => {
    expect(rotationFor(new Date('2026-03-30T00:00:00Z'), members, startsOn)).toBe('ann')
    expect(rotationFor(new Date('2026-04-07T00:00:00Z'), members, startsOn)).toBe('bob')
  })

  it('counts backwards before the start week', () => {
    expect(rotationFor(new Date('2026-03-08T12:00:00Z'), members, startsOn)).toBe('cy')
    expect(rotationFor(new Date('2026-03-01T12:00:00Z'), members, startsOn)).toBe('bob')
  })

  it('is null without members, and constant with one', () => {
    expect(rotationFor(new Date(), [], startsOn)).toBeNull()
    expect(rotationFor(new Date('2030-01-01T00:00:00Z'), ['solo'], startsOn)).toBe('solo')
  })
})

describe('rotationHandover', () => {
  it('is the next Monday midnight', () => {
    expect(rotationHandover(new Date('2026-03-11T15:00:00Z')).toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    )
    expect(rotationHandover(new Date('2026-03-16T00:00:00Z')).toISOString()).toBe(
      '2026-03-23T00:00:00.000Z',
    )
  })
})
