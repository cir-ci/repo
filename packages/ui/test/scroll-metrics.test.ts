import { describe, expect, it } from 'vitest'

import {
  pageDirection,
  pageScroll,
  scrollForDrag,
  thumbFor,
  type AxisMetrics,
} from '../src/scroll-metrics.ts'

const axis = (viewport: number, content: number, scroll = 0): AxisMetrics => ({
  viewport,
  content,
  scroll,
})

describe('thumbFor', () => {
  it('has no thumb when the content fits', () => {
    expect(thumbFor(axis(400, 400), 400)).toBeNull()
    expect(thumbFor(axis(400, 400.4), 400)).toBeNull()
    expect(thumbFor(axis(400, 300), 400)).toBeNull()
  })

  it('sizes the thumb as the visible share of the track', () => {
    expect(thumbFor(axis(400, 800), 400)).toEqual({ size: 200, offset: 0 })
  })

  it('moves the thumb with the scroll, ending flush with the track', () => {
    expect(thumbFor(axis(400, 800, 200), 400)).toEqual({ size: 200, offset: 100 })
    expect(thumbFor(axis(400, 800, 400), 400)).toEqual({ size: 200, offset: 200 })
  })

  it('never makes the thumb shorter than the minimum, and keeps it inside the track', () => {
    const thumb = thumbFor(axis(400, 40_000, 39_600), 400)
    expect(thumb?.size).toBe(24)
    expect(thumb?.offset).toBe(376)
  })

  it('clamps an overscrolled position', () => {
    expect(thumbFor(axis(400, 800, 900), 400)?.offset).toBe(200)
    expect(thumbFor(axis(400, 800, -50), 400)?.offset).toBe(0)
  })

  it('has none on a track with no length', () => {
    expect(thumbFor(axis(400, 800), 0)).toBeNull()
  })
})

describe('scrollForDrag', () => {
  const metrics = axis(400, 1200)
  const track = 400
  const thumb = { size: 400 / 3, offset: 0 }

  it('turns the thumb travel into the whole scrollable length', () => {
    // 800px of scroll over 266.67px of travel.
    expect(scrollForDrag(metrics, track, thumb, 0, track - thumb.size)).toBeCloseTo(800)
    expect(scrollForDrag(metrics, track, thumb, 0, 100)).toBeCloseTo(300)
  })

  it('adds to where the drag started', () => {
    expect(scrollForDrag(metrics, track, thumb, 200, 50)).toBeCloseTo(350)
  })

  it('stops at both ends', () => {
    expect(scrollForDrag(metrics, track, thumb, 0, 5000)).toBe(800)
    expect(scrollForDrag(metrics, track, thumb, 300, -5000)).toBe(0)
  })

  it('does not move when the thumb fills the track', () => {
    expect(scrollForDrag(axis(400, 400), 400, { size: 400, offset: 0 }, 0, 100)).toBe(0)
  })
})

describe('pageDirection and pageScroll', () => {
  const thumb = { size: 100, offset: 100 }

  it('pages toward the press, and not at all on the thumb', () => {
    expect(pageDirection(thumb, 50)).toBe(-1)
    expect(pageDirection(thumb, 150)).toBe(0)
    expect(pageDirection(thumb, 250)).toBe(1)
  })

  it('moves a viewport less a tenth, within the ends', () => {
    expect(pageScroll(axis(400, 2000, 0), 1)).toBe(360)
    expect(pageScroll(axis(400, 2000, 360), -1)).toBe(0)
    expect(pageScroll(axis(400, 2000, 1500), 1)).toBe(1600)
    expect(pageScroll(axis(400, 2000, 100), -1)).toBe(0)
  })
})
