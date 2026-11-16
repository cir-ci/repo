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
  it('says valid when the secret signed the body', () => {
    const result = describeDelivery({ headers: headersFor('b'), body, secret: 'b' })
    expect(result).toEqual({ signature: 'valid', line: 'build.completed d1 signature valid' })
  })

  it('says invalid for a signature no known secret made', () => {
    const result = describeDelivery({ headers: headersFor('x'), body, secret: 'a' })
    expect(result.signature).toBe('invalid')
    expect(result.line).toContain('INVALID')
  })

  it('says invalid when the body was changed', () => {
    const result = describeDelivery({ headers: headersFor('a'), body: `${body} `, secret: 'a' })
    expect(result.signature).toBe('invalid')
  })

  it('says not checked for a webhook the seed did not create', () => {
    const result = describeDelivery({ headers: headersFor('a'), body, secret: undefined })
    expect(result.signature).toBe('unchecked')
    expect(result.line).toBe(
      'build.completed d1 signature not checked (webhook not created by the seed)',
    )
  })

  it('says missing without the header, and names absent event and ID', () => {
    const result = describeDelivery({ headers: {}, body, secret: 'a' })
    expect(result).toEqual({ signature: 'missing', line: '(no event) (no ID) no signature' })
  })
})

describe('parseSecrets', () => {
  it('reads secrets by path and ignores anything else', () => {
    expect(parseSecrets('{"/hooks/a":"s1","/b":3}')).toEqual({ '/hooks/a': 's1' })
    expect(parseSecrets('["a"]')).toEqual({})
    expect(parseSecrets('null')).toEqual({})
    expect(parseSecrets('not json')).toEqual({})
  })
})
