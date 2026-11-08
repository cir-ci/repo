import { describe, expect, it } from 'vitest'

import { stepZoom, zoomedWidth, zoomLabel } from '#features/builds/zoom.ts'

describe('stepZoom', () => {
  it('goes from "fit" to 100% in and 50% out', () => {
    expect(stepZoom('fit', 1)).toBe(100)
    expect(stepZoom('fit', -1)).toBe(50)
  })

  it('moves one step at a time and stops at the ends', () => {
    expect(stepZoom(100, 1)).toBe(150)
    expect(stepZoom(100, -1)).toBe(75)
    expect(stepZoom(400, 1)).toBe(400)
    expect(stepZoom(25, -1)).toBe(25)
  })

  it('lands on a step from a value between steps', () => {
    expect(stepZoom(60, 1)).toBe(75)
    expect(stepZoom(60, -1)).toBe(50)
  })
})

describe('zoomedWidth', () => {
  it('scales the real width, rounded', () => {
    expect(zoomedWidth(150, 801)).toBe(1202)
    expect(zoomedWidth(50, 1280)).toBe(640)
  })

  it('leaves "fit" to the container, and so an image of unknown width', () => {
    expect(zoomedWidth('fit', 1280)).toBeUndefined()
    expect(zoomedWidth(200, null)).toBeUndefined()
  })
})

describe('zoomLabel', () => {
  it('names the zoom', () => {
    expect(zoomLabel('fit')).toBe('Fit')
    expect(zoomLabel(150)).toBe('150%')
  })
})
