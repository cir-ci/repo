/**
 * @mentions in a comment. This only finds the tokens (`@ann`, `@ann.lee`); which workspace
 * member a token means is decided by whoever has the member list (`@circi/services`).
 */

/** Longest token we look at; anything longer is not a handle. */
const MAX_TOKEN = 64
const MENTION = /(^|[^\p{L}\p{N}_@.+-])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu

/**
 * The distinct mention tokens of a comment, lowercased, in order of first appearance, without the
 * `@`. An `@` after a letter, digit or `.` (an email address: `ann@example.com`) is not a
 * mention. Punctuation that ends a sentence or a clause (`@ann,` `@ann.` `@ann-`) is not part of
 * the token.
 */
export function parseMentions(body: string): string[] {
  const seen = new Set<string>()
  for (const match of body.matchAll(MENTION)) {
    const token = (match[2] ?? '').replace(/[._-]+$/, '').toLowerCase()
    if (token && token.length <= MAX_TOKEN) seen.add(token)
  }
  return [...seen]
}
