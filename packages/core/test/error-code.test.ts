import { describe, expect, it } from 'vitest'

import { errorCode } from '#src/index.ts'

describe('errorCode', () => {
  it("reads an error's string code, and nothing else", () => {
    expect(errorCode(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errorCode(new Error('no code'))).toBeUndefined()
    expect(errorCode(Object.assign(new Error('numeric'), { code: 42 }))).toBeUndefined()
    expect(errorCode({ code: 'ENOENT' })).toBeUndefined()
    expect(errorCode('ENOENT')).toBeUndefined()
  })
})
