import { describe, expect, it } from 'vitest'

import { type NavGroup, navigationStops, stepStop, walkPosition } from '#lib/use-list-navigation.ts'

const id = (s: string) => s
const groups = (collapsed: Record<string, boolean> = {}): NavGroup<string>[] => [
  { id: 'changed', items: ['a', 'b'], collapsed: collapsed['changed'] ?? false },
  { id: 'flaky', items: ['c'], collapsed: collapsed['flaky'] ?? true },
  { id: 'unchanged', items: ['d', 'e'], collapsed: collapsed['unchanged'] ?? true },
]

describe('navigationStops', () => {
  it('has every item of an open group and only the header of a collapsed one', () => {
    expect(navigationStops(groups(), id).map((s) => `${s.type}:${s.id}`)).toEqual([
      'item:a',
      'item:b',
      'group:flaky',
      'group:unchanged',
    ])
    expect(navigationStops(groups({ flaky: false }), id).map((s) => `${s.type}:${s.id}`)).toEqual([
      'item:a',
      'item:b',
      'item:c',
      'group:unchanged',
    ])
  })
})

describe('walkPosition and stepStop', () => {
  const stops = navigationStops(groups(), id)

  it('starts from the selected item', () => {
    expect(walkPosition(stops, groups(), undefined, 'b', id)).toBe(1)
    expect(walkPosition(stops, groups(), undefined, undefined, id)).toBe(-1)
  })

  it('starts from the header holding focus: a collapsed group is a stop, an open one sits before its first item', () => {
    expect(walkPosition(stops, groups(), 'flaky', 'a', id)).toBe(2)
    expect(walkPosition(stops, groups(), 'changed', 'b', id)).toBe(-0.5)
    const open = groups({ flaky: false })
    const openStops = navigationStops(open, id)
    expect(walkPosition(openStops, open, 'flaky', 'a', id)).toBe(1.5)
  })

  it('steps one stop, including from a half step, and stops at the ends', () => {
    expect(stepStop(4, 1, 1)).toBe(2)
    expect(stepStop(4, 2, -1)).toBe(1)
    expect(stepStop(4, 1.5, 1)).toBe(2)
    expect(stepStop(4, 1.5, -1)).toBe(1)
    expect(stepStop(4, -0.5, 1)).toBe(0)
    expect(stepStop(4, 3, 1)).toBe(3)
    expect(stepStop(4, 0, -1)).toBe(0)
    expect(stepStop(4, -1, 1)).toBe(0)
    expect(stepStop(4, -1, -1)).toBe(3)
    expect(stepStop(0, -1, 1)).toBeUndefined()
  })
})
