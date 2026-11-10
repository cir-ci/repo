import { describe, expect, it } from 'vitest'

import { PANE_IDS, paneLimits, PANES, paneRendered, paneWidth, paneWidthCss } from '#lib/panes.ts'

describe('paneLimits', () => {
  it('is the pane own range in a wide container', () => {
    for (const id of PANE_IDS) {
      expect(paneLimits(id, 4000)).toEqual({ min: PANES[id].min, max: PANES[id].max })
    }
  })

  it('takes the smaller of the share and what leaves the content its space', () => {
    // Half of 900 is 450; 900 - 380 leaves 520.
    expect(paneLimits('triage-pane', 900)).toEqual({ min: 320, max: 450 })
    // Half of 740 is 370; 740 - 380 leaves 360.
    expect(paneLimits('triage-pane', 740)).toEqual({ min: 320, max: 360 })
    expect(paneLimits('sidebar', 900)).toEqual({ min: 200, max: 270 })
  })

  it('lets the minimum give way where it cannot fit, and is never negative', () => {
    expect(paneLimits('triage-pane', 600)).toEqual({ min: 220, max: 220 })
    expect(paneLimits('triage-pane', 300)).toEqual({ min: 0, max: 0 })
    for (const id of PANE_IDS) {
      for (let c = 0; c <= 3000; c += 7) {
        const { min, max } = paneLimits(id, c)
        expect(min).toBeGreaterThanOrEqual(0)
        expect(min).toBeLessThanOrEqual(max)
        expect(max).toBeLessThanOrEqual(c * PANES[id].maxShare)
        expect(max).toBeLessThanOrEqual(Math.max(0, c - PANES[id].minMain))
      }
    }
  })

  it('keeps the build page viewer 360px wide with both side columns at their limits', () => {
    // The grid is the viewport less the 260px of the sidebar and its margins; three columns from 1100px.
    for (let c = 840; c <= 3000; c++) {
      const rail = paneLimits('build-rail', c).max
      const panel = paneLimits('build-discussion', c).max
      expect(c - rail - panel).toBeGreaterThanOrEqual(360)
    }
  })
})

describe('paneRendered', () => {
  it('holds a stored width to the limits and keeps it when there is room', () => {
    expect(paneRendered('triage-pane', 720, 900)).toBe(450)
    expect(paneRendered('triage-pane', 720, 1600)).toBe(720)
    expect(paneRendered('triage-pane', 420, 1600)).toBe(420)
    expect(paneRendered('triage-pane', 320, 600)).toBe(220)
  })
})

describe('paneWidth', () => {
  it('holds a stored width to the absolute range only', () => {
    expect(paneWidth('triage-pane', 9999)).toBe(720)
    expect(paneWidth('triage-pane', 1)).toBe(320)
    expect(paneWidth('triage-pane', 'x')).toBe(420)
  })
})

describe('paneWidthCss', () => {
  it('writes the same rule as CSS', () => {
    expect(paneWidthCss('triage-pane', 500)).toBe(
      'min(max(320px, 500px), max(0px, min(720px, 50%, 100% - 380px)))',
    )
    expect(paneWidthCss('sidebar', 244)).toBe(
      'min(max(200px, 244px), max(0px, min(360px, 30%, 100% - 400px)))',
    )
  })
})
