import { describe, expect, it } from 'vitest'

import { shardFromArgs } from '../src/shard.ts'

describe('shardFromArgs', () => {
  it('reads Vitest’s 1-based --shard in both spellings', () => {
    expect(shardFromArgs(['node', 'vitest', '--shard=2/4'])).toEqual({ index: 1, total: 4 })
    expect(shardFromArgs(['vitest', '--shard', '1/3'])).toEqual({ index: 0, total: 3 })
  })
  it('ignores anything else', () => {
    expect(shardFromArgs(['vitest', 'run'])).toBeUndefined()
    expect(shardFromArgs(['--shard=5/4'])).toBeUndefined()
    expect(shardFromArgs(['--shard=0/4'])).toBeUndefined()
  })
})
