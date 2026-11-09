import type { Comment } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  describeRegion,
  nudgeRegion,
  regionFromPoints,
  regionStyle,
  regionThreads,
  START_REGION,
} from '#features/regions/geometry.ts'

const box = { left: 100, top: 50, width: 400, height: 200 }

describe('regionFromPoints', () => {
  it('turns a drag into fractions of the image', () => {
    expect(regionFromPoints(box, { x: 140, y: 100 }, { x: 300, y: 200 })).toEqual({
      x: 0.1,
      y: 0.25,
      width: 0.4,
      height: 0.5,
    })
  })

  it('works whichever way the drag goes', () => {
    expect(regionFromPoints(box, { x: 300, y: 200 }, { x: 140, y: 100 })).toEqual(
      regionFromPoints(box, { x: 140, y: 100 }, { x: 300, y: 200 }),
    )
  })

  it('clips a drag that leaves the image', () => {
    expect(regionFromPoints(box, { x: 0, y: 0 }, { x: 900, y: 150 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.5,
    })
  })

  it('treats a click, a sliver or an empty box as no region', () => {
    expect(regionFromPoints(box, { x: 200, y: 100 }, { x: 201, y: 101 })).toBeNull()
    expect(regionFromPoints(box, { x: 200, y: 100 }, { x: 400, y: 100 })).toBeNull()
    expect(regionFromPoints({ ...box, width: 0 }, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull()
  })
})

describe('regionStyle', () => {
  it('places the region in percent', () => {
    expect(regionStyle({ x: 0.1, y: 0.25, width: 0.4, height: 0.5 })).toEqual({
      left: '10%',
      top: '25%',
      width: '40%',
      height: '50%',
    })
  })
})

describe('regionThreads', () => {
  const region: Comment.Region = { x: 0, y: 0, width: 0.5, height: 0.5 }
  const make = (id: string, over: Partial<Comment.Item>): Comment.Item => ({
    id,
    parentId: null,
    snapshotName: 'home',
    region,
    regionSide: 'current',
    body: id,
    author: null,
    createdAt: '',
    editedAt: null,
    deletedAt: null,
    mine: false,
    canDelete: false,
    ...over,
  })

  it('keeps live top-level comments pinned on this snapshot', () => {
    const list = [
      make('a', {}),
      make('b', { snapshotName: 'pricing' }),
      make('c', { region: null }),
      make('d', { parentId: 'a' }),
      make('e', { deletedAt: 'x' }),
    ]
    expect(regionThreads(list, 'home').map((c) => c.id)).toEqual(['a'])
  })
})

describe('nudgeRegion', () => {
  it('moves a region one step with the arrow keys', () => {
    expect(nudgeRegion(START_REGION, 'ArrowRight', false)).toEqual({ ...START_REGION, x: 0.41 })
    expect(nudgeRegion(START_REGION, 'ArrowLeft', false)).toEqual({ ...START_REGION, x: 0.39 })
    expect(nudgeRegion(START_REGION, 'ArrowDown', false)).toEqual({ ...START_REGION, y: 0.41 })
    expect(nudgeRegion(START_REGION, 'ArrowUp', false)).toEqual({ ...START_REGION, y: 0.39 })
  })

  it('resizes with Shift: width with left and right, height with up and down', () => {
    expect(nudgeRegion(START_REGION, 'ArrowRight', true)).toEqual({ ...START_REGION, width: 0.21 })
    expect(nudgeRegion(START_REGION, 'ArrowLeft', true)).toEqual({ ...START_REGION, width: 0.19 })
    expect(nudgeRegion(START_REGION, 'ArrowDown', true)).toEqual({ ...START_REGION, height: 0.21 })
    expect(nudgeRegion(START_REGION, 'ArrowUp', true)).toEqual({ ...START_REGION, height: 0.19 })
  })

  it('keeps the region on the image and above the smallest size', () => {
    const corner = { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }
    expect(nudgeRegion(corner, 'ArrowRight', false)).toEqual(corner)
    expect(nudgeRegion(corner, 'ArrowDown', false)).toEqual(corner)
    expect(nudgeRegion(corner, 'ArrowRight', true)).toEqual(corner)
    const origin = { x: 0, y: 0, width: 0.02, height: 0.02 }
    expect(nudgeRegion(origin, 'ArrowLeft', false)).toEqual(origin)
    expect(nudgeRegion(origin, 'ArrowLeft', true)).toEqual(origin)
    expect(nudgeRegion(origin, 'ArrowUp', true)).toEqual(origin)
  })

  it('ignores other keys, and never drifts on repeated steps', () => {
    expect(nudgeRegion(START_REGION, 'a', false)).toBeUndefined()
    let region = START_REGION
    for (let i = 0; i < 30; i += 1) region = nudgeRegion(region, 'ArrowRight', false) ?? region
    expect(region.x).toBe(0.7)
  })
})

describe('describeRegion', () => {
  it('says where the region is in percent', () => {
    expect(describeRegion(START_REGION)).toBe(
      '40% from the left, 40% from the top, 20% wide, 20% high',
    )
  })
})
