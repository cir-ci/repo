/** @mention autocomplete: finding the token being typed, matching members, inserting the handle. */

export namespace Mention {
  export interface Member {
    userId: string
    name: string
    email: string
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

/** `text` with the token replaced by `@handle ` and where the caret goes after it. */
export function insertMention(text: string, token: Mention.Token, handle: string) {
  const insert = `@${handle} `
  return {
    text: text.slice(0, token.start) + insert + text.slice(token.end),
    caret: token.start + insert.length,
  }
}
