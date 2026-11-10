/** @mention autocomplete: finding the token being typed, matching members, inserting the handle. */

export namespace Mention {
  export interface Member {
    userId: string
    name: string
    email: string
  }

  /** A stretch of a comment: plain text, or (with `member`) a mention of them. `at` is where it starts. */
  export interface Piece {
    at: number
    text: string
    member?: Member
  }

  export interface Token {
    /** Index of the `@`. */
    start: number
    /** The caret: the token runs from `start` to here. */
    end: number
    /** What is typed after the `@`. */
    query: string
  }
}

const TOKEN_CHAR = /^[\p{L}\p{N}._-]*$/u

/**
 * The `@token` the caret is inside of, or null. An `@` only starts a mention at the beginning of
 * the text or after whitespace or an opening bracket, so an email address is left alone.
 */
export function mentionAt(text: string, caret: number): Mention.Token | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('@')
  if (start < 0) return null
  const query = before.slice(start + 1)
  if (!TOKEN_CHAR.test(query)) return null
  const prev = start === 0 ? '' : (before[start - 1] ?? '')
  if (prev !== '' && !/[\s([{]/.test(prev)) return null
  return { start, end: caret, query }
}

const handleOf = (m: Mention.Member) => m.email.split('@')[0]?.toLowerCase() ?? ''

/**
 * The word to write after the `@` for `member`: the part of their email before the `@` when no
 * one else shares it (the server resolves it that way), otherwise their name as one word.
 */
export function mentionHandle(member: Mention.Member, all: readonly Mention.Member[]): string {
  const local = handleOf(member)
  const unique = all.filter((m) => handleOf(m) === local).length === 1
  if (local && unique) return local
  return member.name.toLowerCase().split(/\s+/).filter(Boolean).join('-') || local
}

/** Members whose name or email contains `query`, those that start with it first. */
export function matchMembers<T extends Mention.Member>(
  members: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const q = query.toLowerCase()
  const rank = (m: T) => {
    const fields = [m.name.toLowerCase(), handleOf(m)]
    if (q === '' || fields.some((f) => f.startsWith(q))) return 0
    if (fields.some((f) => f.includes(q)) || m.email.toLowerCase().includes(q)) return 1
    return 2
  }
  return members
    .map((m, i) => ({ m, i, r: rank(m) }))
    .filter((x) => x.r < 2)
    .toSorted((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m)
}

/** `@token` as the server finds it (`parseMentions` in `@circi/core`), with where it sits. */
const MENTION = /(^|[^\p{L}\p{N}_@.+-])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu

/** Every word a member can be mentioned by: their email's local part, or their name as one word. */
function handlesOf(m: Mention.Member): string[] {
  const words = m.name.toLowerCase().split(/\s+/).filter(Boolean)
  return [handleOf(m), ...['', '-', '.', '_'].map((joiner) => words.join(joiner))].filter(Boolean)
}

/**
 * A comment's text in pieces: plain text, and `@token`s that name exactly one member. The server
 * resolves mentions the same way, so what is drawn as a mention is what notified someone; an
 * unknown or ambiguous token stays plain text.
 */
export function splitMentions(body: string, members: readonly Mention.Member[]): Mention.Piece[] {
  const owners = new Map<string, Set<Mention.Member>>()
  for (const m of members) {
    for (const h of handlesOf(m)) owners.set(h, (owners.get(h) ?? new Set()).add(m))
  }
  const pieces: Mention.Piece[] = []
  let from = 0
  const push = (at: number, text: string, member?: Mention.Member) => {
    if (text) pieces.push(member ? { at, text, member } : { at, text })
  }
  for (const match of body.matchAll(MENTION)) {
    const lead = match[1] ?? ''
    const token = (match[2] ?? '').replace(/[._-]+$/, '')
    const set = owners.get(token.toLowerCase())
    const only = set?.size === 1 ? [...set][0] : undefined
    if (!only) continue
    const start = match.index + lead.length
    push(from, body.slice(from, start))
    push(start, `@${token}`, only)
    from = start + 1 + token.length
  }
  push(from, body.slice(from))
  return pieces
}

/** `text` with the token replaced by `@handle ` and where the caret goes after it. */
export function insertMention(text: string, token: Mention.Token, handle: string) {
  const insert = `@${handle} `
  return {
    text: text.slice(0, token.start) + insert + text.slice(token.end),
    caret: token.start + insert.length,
  }
}
