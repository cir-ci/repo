import { describe, expect, it } from 'vitest'

import { hashToken, issueTeamToken, looksLikeTeamToken } from '#src/node/index.ts'

describe('team tokens', () => {
  it('issues unique, well-formed tokens with a matching hash', () => {
    const a = issueTeamToken()
    const b = issueTeamToken()
    expect(a.token).not.toBe(b.token)
    expect(looksLikeTeamToken(a.token)).toBe(true)
    expect(a.hash).toBe(hashToken(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('has a display hint that does not reveal the secret part', () => {
    const { token, hint } = issueTeamToken()
    expect(hint).toBe(`${token.slice(0, 12)}…`)
    expect(token.length - 12).toBeGreaterThanOrEqual(37)
  })

  it('rejects things that are not tokens', () => {
    expect(looksLikeTeamToken('circi_short')).toBe(false)
    expect(looksLikeTeamToken(`ghp_${'a'.repeat(43)}`)).toBe(false)
  })
})
