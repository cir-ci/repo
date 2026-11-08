import { describe, expect, it } from 'vitest'

import { insertMention, matchMembers, mentionAt, mentionHandle } from '#features/builds/mentions.ts'

const ada = { userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' }
const grace = { userId: 'u2', name: 'Grace Hopper', email: 'grace@example.test' }
const other = { userId: 'u3', name: 'Ada King', email: 'ada@other.test' }

describe('mentionAt', () => {
  it('finds the token the caret is in', () => {
    expect(mentionAt('hi @gr', 6)).toEqual({ start: 3, end: 6, query: 'gr' })
    expect(mentionAt('@', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(mentionAt('see (@ann.lee', 13)).toMatchObject({ query: 'ann.lee' })
  })

  it('looks only up to the caret, and not at an earlier word', () => {
    expect(mentionAt('hi @gr and more', 6)?.query).toBe('gr')
    expect(mentionAt('hi @gr and more', 15)).toBeNull()
  })

  it('leaves email addresses and plain text alone', () => {
    expect(mentionAt('mail ann@example.com', 20)).toBeNull()
    expect(mentionAt('no mention', 10)).toBeNull()
  })
})

describe('matchMembers', () => {
  it('lists everyone for an empty query', () => {
    expect(matchMembers([ada, grace], '')).toEqual([ada, grace])
  })

  it('matches by name or email, prefixes first, ignoring case', () => {
    expect(matchMembers([ada, grace], 'GR')).toEqual([grace])
    expect(matchMembers([ada, grace], 'hopper')).toEqual([grace])
    expect(matchMembers([grace, ada], 'a')).toEqual([ada, grace])
    expect(matchMembers([ada, grace], 'zz')).toEqual([])
  })

  it('stops at the limit', () => {
    expect(matchMembers([ada, grace, other], '', 2)).toHaveLength(2)
  })
})

describe('insertMention', () => {
  it('replaces the token with the handle and a space, and says where the caret goes', () => {
    const token = mentionAt('Hi @gr, ok', 6)
    expect(token).not.toBeNull()
    if (!token) return
    expect(insertMention('Hi @gr, ok', token, 'grace')).toEqual({
      text: 'Hi @grace , ok',
      caret: 10,
    })
  })
})

describe('mentionHandle', () => {
  it('uses the email’s local part when it is unique, else the name as one word', () => {
    expect(mentionHandle(grace, [ada, grace])).toBe('grace')
    expect(mentionHandle(ada, [ada, grace, other])).toBe('ada-lovelace')
  })
})
