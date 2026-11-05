import { describe, expect, it } from 'vitest'

import {
  checkBuildInput,
  isCommitSha,
  isSha256,
  MAX_ANCESTORS,
  ValidationError,
} from '../src/index.ts'

describe('limits', () => {
  it('recognises commit SHAs and sha256 hashes', () => {
    expect(isCommitSha('abc1234')).toBe(true)
    expect(isCommitSha('ABC1234')).toBe(true)
    expect(isCommitSha('abc123')).toBe(false)
    expect(isCommitSha('xyz1234')).toBe(false)
    expect(isSha256('a'.repeat(64))).toBe(true)
    expect(isSha256('A'.repeat(64))).toBe(false)
  })

  it('normalises valid build input', () => {
    expect(checkBuildInput({ commitSha: 'ABC1234', ancestorShas: ['DEF5678'] })).toEqual({
      name: 'default',
      commitSha: 'abc1234',
      ancestorShas: ['def5678'],
    })
  })

  it.each([
    [{ commitSha: 'abc1234', name: '-bad' }, /build name/],
    [{ commitSha: 'nope' }, /commit SHA/],
    [{ commitSha: 'abc1234', ancestorShas: ['nope'] }, /ancestorShas/],
    [
      { commitSha: 'abc1234', ancestorShas: Array(MAX_ANCESTORS + 1).fill('abc1234') },
      /ancestorShas/,
    ],
    [{ commitSha: 'abc1234', parallelTotal: 0 }, /parallel.total/],
    [{ commitSha: 'abc1234', parallelTotal: 1001 }, /parallel.total/],
  ])('rejects %j', (input, message) => {
    expect(() => checkBuildInput(input)).toThrow(ValidationError)
    expect(() => checkBuildInput(input)).toThrow(message)
  })
})
