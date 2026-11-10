import type { Comment } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  adjustRegion,
  CORNERS,
  cursorFor,
  DRAG_SLOP_PX,
  minimumFractions,
  pastSlop,
  sameRegion,
} from '#features/regions/regions.ts'

const box = { left: 100, top: 50, width: 400, height: 200 }
const region: Comment.Region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

describe('cursorFor', () => {
  it('shows the diagonal of the corner, and move for the body', () => {
    expect(cursorFor('nw')).toBe('nwse-resize')
    expect(cursorFor('se')).toBe('nwse-resize')
    expect(cursorFor('ne')).toBe('nesw-resize')
    expect(cursorFor('sw')).toBe('nesw-resize')
    expect(cursorFor('move')).toBe('move')
    expect(CORNERS).toHaveLength(4)
  })
})

describe('pastSlop', () => {
  it('is a click until the pointer has gone a few pixels in either direction', () => {
    expect(pastSlop(0, 0)).toBe(false)
    expect(pastSlop(DRAG_SLOP_PX - 1, -(DRAG_SLOP_PX - 1))).toBe(false)
    expect(pastSlop(0, -DRAG_SLOP_PX)).toBe(true)
    expect(pastSlop(DRAG_SLOP_PX, 0)).toBe(true)
  })
})

describe('minimumFractions', () => {
  it('turns 8 screen pixels into fractions of the image', () => {
    const min = minimumFractions({ left: 0, top: 0, width: 400, height: 200 })
    expect(min.width).toBeCloseTo(0.02)
    expect(min.height).toBeCloseTo(0.04)
  })

  it('never goes under the 1% a drawn region needs, however large the image is shown', () => {
    expect(minimumFractions({ left: 0, top: 0, width: 4000, height: 4000 })).toEqual({
      width: 0.01,
      height: 0.01,
    })
  })
})

describe('adjustRegion: moving', () => {
  it('moves by the pointer and keeps the size', () => {
    // 40px of 400 is 0.1 across; 20px of 200 is 0.1 down.
    expect(adjustRegion(region, 'move', 40, 20, box)).toEqual({
      x: 0.35,
      y: 0.35,
      width: 0.5,
      height: 0.5,
    })
    const back = adjustRegion(region, 'move', -40, -20, box)
    expect(back.x).toBeCloseTo(0.15)
    expect(back.y).toBeCloseTo(0.15)
    expect(back.width).toBe(0.5)
  })

  it('stops at every edge of the image', () => {
    expect(adjustRegion(region, 'move', 9999, 9999, box)).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    })
    expect(adjustRegion(region, 'move', -9999, -9999, box)).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    })
  })

  it('leaves the region alone when the image has no size', () => {
    expect(adjustRegion(region, 'move', 10, 10, { ...box, width: 0 })).toBe(region)
  })
})

describe('adjustRegion: resizing', () => {
  it('moves the grabbed corner and keeps the opposite one fixed', () => {
    const se = adjustRegion(region, 'se', 40, 20, box)
    expect(se).toEqual({ x: 0.25, y: 0.25, width: 0.6, height: 0.6 })
    const nw = adjustRegion(region, 'nw', -40, -20, box)
    expect(nw.x).toBeCloseTo(0.15)
    expect(nw.y).toBeCloseTo(0.15)
    expect(nw.x + nw.width).toBeCloseTo(0.75)
    expect(nw.y + nw.height).toBeCloseTo(0.75)
  })

  it('ne keeps the bottom-left and sw keeps the top-right', () => {
    const ne = adjustRegion(region, 'ne', 40, -20, box)
    expect(ne.x).toBe(0.25)
    expect(ne.y).toBeCloseTo(0.15)
    expect(ne.width).toBeCloseTo(0.6)
    expect(ne.y + ne.height).toBeCloseTo(0.75)
    const sw = adjustRegion(region, 'sw', -40, 20, box)
    expect(sw.x).toBeCloseTo(0.15)
    expect(sw.y).toBe(0.25)
    expect(sw.x + sw.width).toBeCloseTo(0.75)
    expect(sw.height).toBeCloseTo(0.6)
  })

  it('stops the grabbed corner at the image edge', () => {
    expect(adjustRegion(region, 'se', 9999, 9999, box)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.75,
      height: 0.75,
    })
    expect(adjustRegion(region, 'nw', -9999, -9999, box)).toEqual({
      x: 0,
      y: 0,
      width: 0.75,
      height: 0.75,
    })
  })

  it('keeps 8 screen pixels, and never flips over the opposite corner', () => {
    const squeezed = adjustRegion(region, 'se', -9999, -9999, box)
    expect(squeezed.x).toBe(0.25)
    expect(squeezed.y).toBe(0.25)
    expect(squeezed.width).toBeCloseTo(0.02)
    expect(squeezed.height).toBeCloseTo(0.04)
    const flipped = adjustRegion(region, 'nw', 9999, 9999, box)
    expect(flipped.x + flipped.width).toBeCloseTo(0.75)
    expect(flipped.width).toBeCloseTo(0.02)
    expect(flipped.height).toBeCloseTo(0.04)
  })

  it('moves one side only when the pointer moves along one axis', () => {
    expect(adjustRegion(region, 'se', 40, 0, box)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.6,
      height: 0.5,
    })
  })
})

describe('sameRegion', () => {
  it('compares the rectangles', () => {
    expect(sameRegion(region, { ...region })).toBe(true)
    expect(sameRegion(region, { ...region, width: 0.51 })).toBe(false)
  })
})
