import { describe, expect, it } from 'vitest'

import { describeDelivery, eventDescription } from '#features/teams/webhook-events.ts'

describe('eventDescription', () => {
  it('explains the events the server sends today', () => {
    expect(eventDescription('build.completed')).toMatch(/finished processing/)
    expect(eventDescription('build.reviewed')).toMatch(/approved or rejected/)
  })

  it('has nothing to say about an event the server adds later', () => {
    expect(eventDescription('build.exploded')).toBeUndefined()
  })
})

const delivery = (over: Partial<Parameters<typeof describeDelivery>[0]> = {}) => ({
  statusCode: 200,
  error: null,
  attempt: 1,
  test: false,
  ...over,
})

describe('describeDelivery', () => {
  it('reads a 2xx answer as delivered', () => {
    expect(describeDelivery(delivery())).toEqual({ text: '200 delivered', ok: true })
    expect(describeDelivery(delivery({ statusCode: 299 })).ok).toBe(true)
  })

  it('reads any other answer as failed, with its code', () => {
    expect(describeDelivery(delivery({ statusCode: 500 }))).toEqual({
      text: '500 failed',
      ok: false,
    })
    expect(describeDelivery(delivery({ statusCode: 301 })).ok).toBe(false)
    expect(describeDelivery(delivery({ statusCode: 199 })).ok).toBe(false)
  })

  it('gives the reason when there was no answer, or says there was none', () => {
    expect(describeDelivery(delivery({ statusCode: null, error: 'ECONNREFUSED' }))).toEqual({
      text: 'ECONNREFUSED failed',
      ok: false,
    })
    expect(describeDelivery(delivery({ statusCode: null })).text).toBe('No answer failed')
  })

  it('notes later attempts and test deliveries', () => {
    expect(describeDelivery(delivery({ attempt: 3, test: true })).text).toBe(
      '200 delivered, attempt 3, test',
    )
    expect(describeDelivery(delivery({ statusCode: 502, attempt: 2 })).text).toBe(
      '502 failed, attempt 2',
    )
  })
})
