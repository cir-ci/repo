import { describe, expect, it } from 'vitest'

import { parseMentions } from '#src/index.ts'

describe('parseMentions', () => {
  it('finds tokens, lowercased, once each, in order', () => {
    expect(parseMentions('@Ann please look, cc @bob and @ann again')).toEqual(['ann', 'bob'])
  })

  it('finds a mention at the start, after a newline and in brackets', () => {
    expect(parseMentions('@ann\n(@bob) "@cy"')).toEqual(['ann', 'bob', 'cy'])
  })

  it('does not treat email addresses as mentions', () => {
    expect(parseMentions('mail ann@example.com or a.b+c@x.io')).toEqual([])
    expect(parseMentions('ann@example.com and @bob')).toEqual(['bob'])
  })

  it('drops trailing punctuation but keeps inner dots, dashes and underscores', () => {
    expect(parseMentions('thanks @ann. and @bob, @cy-lee! @di_x? @ed.')).toEqual([
      'ann',
      'bob',
      'cy-lee',
      'di_x',
      'ed',
    ])
    expect(parseMentions('@ann.lee')).toEqual(['ann.lee'])
  })

  it('ignores a bare @ and empty text', () => {
    expect(parseMentions('')).toEqual([])
    expect(parseMentions('@ and @@ann and @.x')).toEqual([])
  })
})
