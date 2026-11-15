import { signWebhook } from '@circi/core/node'
import { describe, expect, it } from 'vitest'

import { describeDelivery, parseSecrets } from '../src/webhook-delivery.ts'

const body = JSON.stringify({ id: 'd1', event: 'build.completed' })
const headersFor = (secret: string, extra: Record<string, string> = {}) => ({
  'circi-event': 'build.completed',
  'circi-delivery': 'd1',
  'circi-signature': signWebhook(secret, body),
  ...extra,
})

describe('describeDelivery', () => {
  it('says valid when one of the secrets signed the body', () => {
    const result = describeDelivery({ headers: headersFor('b'), body, secrets: ['a', 'b'] })
    expect(result).toEqual({ signature: 'valid', line: 'build.completed d1 signature valid' })
  })

  it('says invalid for a signature no known secret made', () => {
    const result = describeDelivery({ headers: headersFor('x'), body, secrets: ['a'] })
    expect(result.signature).toBe('invalid')
    expect(result.line).toContain('INVALID')
  })

  it('says invalid when the body was changed', () => {
    const result = describeDelivery({ headers: headersFor('a'), body: `${body} `, secrets: ['a'] })
    expect(result.signature).toBe('invalid')
  })

  it('says unknown when no secret is saved yet', () => {
    expect(describeDelivery({ headers: headersFor('a'), body, secrets: [] }).signature).toBe(
      'unknown',
    )
  })

  it('says missing without the header, and names absent event and ID', () => {
    const result = describeDelivery({ headers: {}, body, secrets: ['a'] })
    expect(result).toEqual({ signature: 'missing', line: '(no event) (no ID) no signature' })
  })
})

describe('parseSecrets', () => {
  it('reads an array of strings and ignores anything else', () => {
    expect(parseSecrets('["a","b",3]')).toEqual(['a', 'b'])
    expect(parseSecrets('{"a":1}')).toEqual([])
    expect(parseSecrets('not json')).toEqual([])
  })
})
