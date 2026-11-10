import { describe, expect, it } from 'vitest'

import {
  EDGE_PX,
  edgeVelocity,
  MAX_STEP_PX,
  scrolledSince,
  scrollStep,
  withScrolled,
} from '#features/regions/auto-scroll.ts'

describe('edgeVelocity', () => {
  it('is zero while the pointer is further than the edge zone from both edges', () => {
    expect(edgeVelocity(300, 100, 500)).toBe(0)
    expect(edgeVelocity(100 + EDGE_PX, 100, 500)).toBe(0)
    expect(edgeVelocity(500 - EDGE_PX, 100, 500)).toBe(0)
  })

  it('scrolls toward the near edge, faster the closer the pointer is', () => {
    const far = edgeVelocity(500 - 24, 100, 500)
    const near = edgeVelocity(500 - 8, 100, 500)
    expect(far).toBeGreaterThan(0)
    expect(near).toBeGreaterThan(far)
    expect(edgeVelocity(100 + 24, 100, 500)).toBeLessThan(0)
    expect(edgeVelocity(100 + 8, 100, 500)).toBeLessThan(edgeVelocity(100 + 24, 100, 500))
  })

  it('is half the top speed at the edge itself', () => {
    expect(edgeVelocity(500, 100, 500)).toBe(MAX_STEP_PX / 2)
    expect(edgeVelocity(100, 100, 500)).toBe(-MAX_STEP_PX / 2)
  })

  it('reaches the top speed a full edge zone past the edge, and never exceeds it', () => {
    expect(edgeVelocity(500 + EDGE_PX, 100, 500)).toBe(MAX_STEP_PX)
    expect(edgeVelocity(500 + 400, 100, 500)).toBe(MAX_STEP_PX)
    expect(edgeVelocity(100 - EDGE_PX, 100, 500)).toBe(-MAX_STEP_PX)
    expect(edgeVelocity(-900, 100, 500)).toBe(-MAX_STEP_PX)
  })

  it('takes the nearer edge in an area too small to have a middle', () => {
    expect(edgeVelocity(110, 100, 130)).toBeLessThan(0)
    expect(edgeVelocity(122, 100, 130)).toBeGreaterThan(0)
  })

  it('honours custom zone and speed', () => {
    expect(edgeVelocity(500, 100, 500, 10, 4)).toBe(2)
    expect(edgeVelocity(480, 100, 500, 10, 4)).toBe(0)
  })
})

describe('scrollStep', () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 350 }

  it('works out each axis on its own', () => {
    expect(scrollStep(rect, { x: 300, y: 200 })).toEqual({ x: 0, y: 0 })
    expect(scrollStep(rect, { x: 500, y: 200 })).toEqual({ x: MAX_STEP_PX / 2, y: 0 })
    expect(scrollStep(rect, { x: 300, y: 50 })).toEqual({ x: 0, y: -MAX_STEP_PX / 2 })
    expect(scrollStep(rect, { x: 600, y: 400 })).toEqual({ x: MAX_STEP_PX, y: MAX_STEP_PX })
  })
})

describe('the coordinate correction', () => {
  it('adds what the area scrolled to the pointer, so the point under it is the one pressed in', () => {
    expect(withScrolled({ x: 200, y: 340 }, { x: 0, y: 150 })).toEqual({ x: 200, y: 490 })
    expect(withScrolled({ x: 200, y: 340 }, { x: 0, y: 0 })).toEqual({ x: 200, y: 340 })
  })

  it('measures the scrolled distance from where the area stood at the press', () => {
    expect(scrolledSince({ x: 30, y: 420 }, { x: 10, y: 400 })).toEqual({ x: 20, y: 20 })
    expect(scrolledSince({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})
