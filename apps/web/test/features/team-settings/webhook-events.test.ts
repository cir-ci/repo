import { describe, expect, it } from 'vitest'

import {
  attemptLabel,
  type DeliveryFacts,
  deliveryAnswer,
  eventDescription,
  hookStatus,
} from '#features/team-settings/webhook-events.ts'

describe('eventDescription', () => {
  it('explains the events the server sends today', () => {
    expect(eventDescription('build.completed')).toMatch(/finished processing/)
    expect(eventDescription('build.reviewed')).toMatch(/approved or rejected/)
  })

  it('has nothing to say about an event the server adds later', () => {
    expect(eventDescription('build.exploded')).toBeUndefined()
  })
})

const delivery = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
  statusCode: 200,
  error: null,
  attempt: 1,
  test: false,
  ...over,
})

describe('deliveryAnswer', () => {
  it('reads a 2xx answer as ok, showing its code', () => {
    expect(deliveryAnswer(delivery())).toEqual({ text: '200', ok: true })
    expect(deliveryAnswer(delivery({ statusCode: 299 })).ok).toBe(true)
  })

  it('reads any other answer as failed', () => {
    expect(deliveryAnswer(delivery({ statusCode: 502 }))).toEqual({ text: '502', ok: false })
    expect(deliveryAnswer(delivery({ statusCode: 301 })).ok).toBe(false)
    expect(deliveryAnswer(delivery({ statusCode: 199 })).ok).toBe(false)
  })

  it('gives the reason when there was no answer, or says there was none', () => {
    expect(deliveryAnswer(delivery({ statusCode: null, error: 'Timed out' }))).toEqual({
      text: 'Timed out',
      ok: false,
    })
    expect(deliveryAnswer(delivery({ statusCode: null })).text).toBe('No answer')
  })
})

describe('attemptLabel', () => {
  it('counts against the retries of a build event, and one try for a test', () => {
    expect(attemptLabel(delivery({ attempt: 3 }))).toBe('3 of 8')
    expect(attemptLabel(delivery({ test: true }))).toBe('1 of 1')
  })
})

describe('hookStatus', () => {
  it('says nothing was sent yet', () => {
    expect(hookStatus(undefined)).toEqual({ kind: 'none' })
  })

  it('is delivered when the newest attempt got a 2xx', () => {
    expect(hookStatus(delivery())).toEqual({ kind: 'delivered' })
  })

  it('is failing, with the answer and how far through the retries', () => {
    expect(hookStatus(delivery({ statusCode: 502, attempt: 3 }))).toEqual({
      kind: 'failing',
      text: 'Failing: 502, retrying 3/8',
    })
  })

  it('stops promising a retry after the last attempt or for a test', () => {
    expect(hookStatus(delivery({ statusCode: 502, attempt: 8 }))).toEqual({
      kind: 'failing',
      text: 'Failing: 502',
    })
    expect(hookStatus(delivery({ statusCode: null, error: 'Timed out', test: true }))).toEqual({
      kind: 'failing',
      text: 'Failing: Timed out',
    })
  })
})
