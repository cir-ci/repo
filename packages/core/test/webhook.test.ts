import { describe, expect, it } from 'vitest'

import { signWebhook, verifyWebhookSignature } from '#src/node/index.ts'

const now = new Date('2026-01-01T00:00:00Z')

describe('webhook signatures', () => {
  it('verifies what it signed', () => {
    const header = signWebhook('whsec_a', '{"a":1}', now)
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(verifyWebhookSignature('whsec_a', '{"a":1}', header, { now })).toBe(true)
  })

  it('rejects a changed body, another secret, and malformed headers', () => {
    const header = signWebhook('whsec_a', '{"a":1}', now)
    expect(verifyWebhookSignature('whsec_a', '{"a":2}', header, { now })).toBe(false)
    expect(verifyWebhookSignature('whsec_b', '{"a":1}', header, { now })).toBe(false)
    for (const bad of [
      '',
      'v1=abc',
      't=1',
      't=x,v1=00',
      `t=${Math.floor(now.getTime() / 1000)},v1=zz`,
    ]) {
      expect(verifyWebhookSignature('whsec_a', '{"a":1}', bad, { now })).toBe(false)
    }
  })

  it('rejects a replay outside the tolerance', () => {
    const header = signWebhook('whsec_a', 'x', now)
    const later = new Date(now.getTime() + 6 * 60_000)
    expect(verifyWebhookSignature('whsec_a', 'x', header, { now: later })).toBe(false)
    expect(
      verifyWebhookSignature('whsec_a', 'x', header, { now: later, toleranceSeconds: 600 }),
    ).toBe(true)
  })
})
