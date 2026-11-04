import { createHash, randomBytes } from 'node:crypto'

/** CI token format: `circi_` + 43 chars of base64url (32 random bytes). */
const TOKEN_PREFIX = 'circi_'
const TOKEN_RE = /^circi_[A-Za-z0-9_-]{43}$/

export interface IssuedToken {
  /** Shown to the user exactly once, never stored. */
  token: string
  /** sha256 hex of the full token; what the database stores and looks up by. */
  hash: string
  /** First characters after the prefix, safe to display ("circi_AbC1…"). */
  hint: string
}

export function issueProjectToken(): IssuedToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token), hint: tokenHint(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function tokenHint(token: string): string {
  return `${token.slice(0, TOKEN_PREFIX.length + 6)}…`
}

export function looksLikeProjectToken(value: string): boolean {
  return TOKEN_RE.test(value)
}
