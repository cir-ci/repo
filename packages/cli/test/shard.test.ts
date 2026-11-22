import { describe, expect, it } from 'vitest'

import { UsageError } from '#src/errors.ts'
import { parseShard, shardFlag, shardFromArgs, shardFromEnv } from '#src/shard.ts'

describe('parseShard', () => {
  it('reads a 1-based job number of a total, as 0-based', () => {
    expect(parseShard('2/4')).toEqual({ index: 1, total: 4 })
    expect(parseShard(' 1/1 ')).toEqual({ index: 0, total: 1 })
  })
  it('refuses anything else', () => {
    expect(parseShard('0/4')).toBeUndefined()
    expect(parseShard('5/4')).toBeUndefined()
    expect(parseShard('a/b')).toBeUndefined()
  })
})

describe('shardFlag', () => {
  it('adds the nonce, and says how to write a bad one', () => {
    expect(shardFlag('2/4', 'run-9')).toEqual({ index: 1, total: 4, nonce: 'run-9' })
    expect(shardFlag('2/4')).toEqual({ index: 1, total: 4 })
    expect(() => shardFlag('9')).toThrow(UsageError)
  })
})

describe('shardFromArgs', () => {
  it("reads Vitest's 1-based --shard in both spellings", () => {
    expect(shardFromArgs(['node', 'vitest', '--shard=2/4'])).toEqual({ index: 1, total: 4 })
    expect(shardFromArgs(['vitest', '--shard', '1/3'])).toEqual({ index: 0, total: 3 })
  })
  it('ignores anything else', () => {
    expect(shardFromArgs(['vitest', 'run'])).toBeUndefined()
    expect(shardFromArgs(['--shard=5/4'])).toBeUndefined()
    expect(shardFromArgs(['--shard=0/4'])).toBeUndefined()
  })
})

describe('shardFromEnv', () => {
  it('reads CIRCI_SHARD', () => {
    expect(shardFromEnv({ CIRCI_SHARD: '3/5' })).toEqual({ index: 2, total: 5 })
    expect(shardFromEnv({ CIRCI_SHARD: 'x' })).toBeUndefined()
    expect(shardFromEnv({})).toBeUndefined()
  })
})
