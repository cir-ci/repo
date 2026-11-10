import { describe, expect, it } from 'vitest'

import { draftOf, draftRegion, type RegionDraft } from '#features/builds/region-draft.ts'
import { regionFromPoints } from '#features/regions/geometry.ts'

const draft: RegionDraft = {
  shotId: 's1',
  side: 'build',
  region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
}

describe('a region belongs to one snapshot and one side', () => {
  it('shows on the snapshot and side it was drawn on only', () => {
    expect(draftRegion(draft, 's1', 'build')).toEqual(draft.region)
    expect(draftRegion(draft, 's1', 'baseline')).toBeNull()
    expect(draftRegion(draft, 's2', 'build')).toBeNull()
    expect(draftRegion(null, 's1', 'build')).toBeNull()
  })

  it('is no draft for another snapshot', () => {
    expect(draftOf(draft, 's1')).toBe(draft)
    expect(draftOf(draft, 's2')).toBeNull()
    expect(draftOf(draft, undefined)).toBeNull()
  })
})

describe('drawing by pointer', () => {
  const box = { left: 0, top: 0, width: 400, height: 300 }

  it('treats a drag under 8 pixels in either direction as a click', () => {
    expect(regionFromPoints(box, { x: 10, y: 10 }, { x: 17, y: 100 }, 8)).toBeNull()
    expect(regionFromPoints(box, { x: 10, y: 10 }, { x: 100, y: 17 }, 8)).toBeNull()
    expect(regionFromPoints(box, { x: 10, y: 10 }, { x: 18, y: 18 }, 8)).not.toBeNull()
  })
})
