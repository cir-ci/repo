import { describe, expect, it } from 'vitest'

import { asRecord, isRecord, items, str } from '#src/json.ts'

describe('json narrowing', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('asRecord copies an object and gives {} for anything else', () => {
    const source = { a: 1 }
    expect(asRecord(source)).toEqual({ a: 1 })
    expect(asRecord(source)).not.toBe(source)
    expect(asRecord([1])).toEqual({})
    expect(asRecord(undefined)).toEqual({})
  })

  it('str returns strings, else the fallback', () => {
    expect(str('x')).toBe('x')
    expect(str(1)).toBe('')
    expect(str(undefined, 'none')).toBe('none')
  })

  it('items returns arrays, else an empty one', () => {
    expect(items([1, 2])).toEqual([1, 2])
    expect(items({})).toEqual([])
    expect(items(null)).toEqual([])
  })
})
