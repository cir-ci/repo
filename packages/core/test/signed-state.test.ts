import { describe, expect, it } from 'vitest'

import { signState, verifyState } from '#src/index.ts'

describe('signState / verifyState', () => {
  const secret = 'a-long-instance-secret-for-tests-0123456789'

  it('round-trips the claims', () => {
    const token = signState(secret, { workspaceId: 'o1', userId: 'u1' })
    expect(verifyState(secret, token)).toEqual({ workspaceId: 'o1', userId: 'u1' })
  })

  it('rejects an expired token', () => {
    const token = signState(secret, { workspaceId: 'o1' }, { now: 1_000, ttlMs: 60_000 })
    expect(verifyState(secret, token, { now: 61_000 })).toEqual({ workspaceId: 'o1' })
    expect(verifyState(secret, token, { now: 61_001 })).toBeUndefined()
  })

  it('rejects a token signed with another secret, edited or malformed', () => {
    const token = signState(secret, { workspaceId: 'o1' })
    expect(verifyState('another-secret-another-secret-123456', token)).toBeUndefined()
    const [payload, mac] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ workspaceId: 'o2', exp: Date.now() + 1e6 }),
    ).toString('base64url')
    expect(verifyState(secret, `${forged}.${mac}`)).toBeUndefined()
    expect(verifyState(secret, `${payload}.`)).toBeUndefined()
    expect(verifyState(secret, 'garbage')).toBeUndefined()
    expect(verifyState(secret, '')).toBeUndefined()
  })
})
