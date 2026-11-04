import { describe, expect, it } from 'vitest'
import { hashToken, issueProjectToken, looksLikeProjectToken } from '../src/index.ts'

describe('project tokens', () => {
  it('issues unique, well-formed tokens with a matching hash', () => {
    const a = issueProjectToken()
    const b = issueProjectToken()
    expect(a.token).not.toBe(b.token)
    expect(looksLikeProjectToken(a.token)).toBe(true)
    expect(a.hash).toBe(hashToken(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('has a display hint that does not reveal the secret part', () => {
    const { token, hint } = issueProjectToken()
    expect(hint).toBe(`${token.slice(0, 10)}…`)
    expect(token.length - 10).toBeGreaterThanOrEqual(37)
  })

  it('rejects things that are not tokens', () => {
    expect(looksLikeProjectToken('zop_short')).toBe(false)
    expect(looksLikeProjectToken(`ghp_${'a'.repeat(43)}`)).toBe(false)
  })
})
