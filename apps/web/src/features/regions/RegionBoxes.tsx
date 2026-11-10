import type { Comment, IgnoreRegion } from '@circi/api'

import { regionStyle } from './geometry.ts'
import { type Size, toFractions } from './ignore-regions.ts'
import { RegionHandles, useAdjustable } from './RegionAdjust.tsx'

import styles from './RegionBoxes.module.css'

/**
 * The numbered boxes of a screenshot's ignore regions, to lay over an image of that size. With
 * `onAdjust` (owners and admins) each box can be moved by its body and resized by its corners;
 * `onClick` answers a press on one that does not move it.
 */
export function RegionBoxes({ regions, size, onAdjust, onClick }: RegionBoxes.Props) {
  return regions.map((r, index) => (
    <RegionBox
      key={r.id}
      item={r}
      number={index + 1}
      size={size}
      onAdjust={onAdjust}
      onClick={onClick}
    />
  ))
}

function RegionBox({ item, number, size, onAdjust, onClick }: RegionBox.Props) {
  const box = useAdjustable(
    toFractions(item, size),
    onAdjust ? { onCommit: (region) => onAdjust(item, region), onClick } : undefined,
  )
  return (
    <span className={styles.region} style={regionStyle(box.region)} {...box.props}>
      <span className={styles.tag} aria-hidden="true">
        {number}
      </span>
      {onAdjust ? <RegionHandles /> : null}
    </span>
  )
}

namespace RegionBox {
  export interface Props {
    item: IgnoreRegion.Item
    number: number
    size: Size
    onAdjust: RegionBoxes.Props['onAdjust']
    onClick: RegionBoxes.Props['onClick']
  }
}

export namespace RegionBoxes {
  export interface Props {
    regions: readonly IgnoreRegion.Item[]
    size: Size
    /** Makes the boxes adjustable: the region and where it ended up, as fractions of the image. */
    onAdjust?: ((item: IgnoreRegion.Item, region: Comment.Region) => void) | undefined
    onClick?: (() => void) | undefined
  }
}
