import type { Comment } from '@circi/api'

/** The two images of a snapshot a region can be drawn on. */
export type RegionSide = 'baseline' | 'build'

/** The API's name for a side: the build's own image is `current`. */
export const apiSide = (side: RegionSide): Comment.RegionSide =>
  side === 'baseline' ? 'baseline' : 'current'

/** A region selected and not yet sent: it belongs to one snapshot and one side of it. */
export interface RegionDraft {
  shotId: string
  side: RegionSide
  region: Comment.Region
}

/** The draft's region when it was drawn on this snapshot and side, else null. */
export function draftRegion(
  draft: RegionDraft | null,
  shotId: string | undefined,
  side: RegionSide,
): Comment.Region | null {
  return draft && draft.shotId === shotId && draft.side === side ? draft.region : null
}

/** The draft when it belongs to this snapshot; switching snapshots leaves none. */
export const draftOf = (draft: RegionDraft | null, shotId: string | undefined) =>
  draft && draft.shotId === shotId ? draft : null
