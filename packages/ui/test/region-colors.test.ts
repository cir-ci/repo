import { describe, expect, it } from 'vitest'

import { REGION_HUES, regionColor, regionHue } from '#src/index.ts'

describe('regionHue', () => {
  it('hands out the hues in order from region 1, and starts again after the last', () => {
    expect(REGION_HUES.map((_, i) => regionHue(i + 1))).toEqual([...REGION_HUES])
    expect(regionHue(REGION_HUES.length + 1)).toBe(REGION_HUES[0])
  })

  it('is the same for the same number, and distinct within one palette', () => {
    expect(regionColor(3)).toBe(regionColor(3))
    expect(new Set(REGION_HUES.map((_, i) => regionColor(i + 1))).size).toBe(REGION_HUES.length)
  })

  it('names a token variable', () => {
    expect(regionColor(1)).toBe('var(--circi-region-blue)')
  })

  it('never fails on a number outside the range', () => {
    expect(regionHue(0)).toBe(REGION_HUES.at(-1))
    expect(regionHue(-3)).toBeDefined()
  })
})
