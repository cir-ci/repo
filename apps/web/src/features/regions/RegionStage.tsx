import type { IgnoreRegion } from '@circi/api'
import { EnlargeTrigger } from '@circi/ui'
import { useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'

import { regionStyle } from './geometry.ts'
import { type Size, toFractions } from './ignore-regions.ts'
import { type Annotations, RegionLayer, useRegionGesture } from './RegionLayer.tsx'

import styles from './RegionStage.module.css'

/** The numbered boxes of a screenshot's ignore regions, to lay over an image of that size. */
export function RegionBoxes({ regions, size }: RegionBoxes.Props) {
  return regions.map((r, index) => (
    <span key={r.id} className={styles.region} style={regionStyle(toFractions(r, size))}>
      <span className={styles.tag} aria-hidden="true">
        {index + 1}
      </span>
    </span>
  ))
}

/**
 * The latest screenshot of one name with its ignore regions drawn over it, numbered like the list
 * beside it. With `annotations`, a drag over the image draws a new region (the builds page's
 * gesture and `RegionLayer`, fractions of the image) and a press that does not draw is a click;
 * without them the image only enlarges. With `onEnlarge` the image is a button that asks for it
 * to be shown large.
 */
export function RegionStage({
  name,
  latest,
  size,
  regions,
  annotations,
  onEnlarge,
}: RegionStage.Props) {
  const [loaded, setLoaded] = useState(false)
  const gesture = useRegionGesture(annotations)
  const drawsOnPointer = annotations?.alwaysDraw === true
  const image = latest ? (
    <img
      src={fileUrl(latest.sha256)}
      alt={`${name} in build #${latest.buildNumber}`}
      className={styles.image}
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  ) : null
  return (
    <div className={styles.stage}>
      {/* A press on the image either drags a region or, without moving, enlarges it. The layer is
          a sibling of the trigger, never inside it: markers are buttons. */}
      <div
        className={styles.shot}
        data-loaded={loaded ? '' : undefined}
        data-annotatable={drawsOnPointer ? '' : undefined}
        {...gesture.bind}
      >
        {image && onEnlarge ? (
          <EnlargeTrigger
            label={`Enlarge ${name}`}
            onClick={(e) => {
              // A mouse press was already told apart from a drag when it ended; a key press was not.
              if (drawsOnPointer && e.detail !== 0) return
              onEnlarge()
            }}
          >
            {image}
          </EnlargeTrigger>
        ) : (
          image
        )}
        {size ? <RegionBoxes regions={regions} size={size} /> : null}
        {size && annotations ? (
          <div className={styles.layer}>
            <RegionLayer annotations={annotations} gesture={gesture} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export namespace RegionBoxes {
  export interface Props {
    regions: readonly IgnoreRegion.Item[]
    size: Size
  }
}

export namespace RegionStage {
  export interface Props {
    name: string
    latest: IgnoreRegion.Snapshot['latest']
    /** The screenshot's pixel size; null when unknown (nothing can be drawn over it). */
    size: Size | null
    regions: readonly IgnoreRegion.Item[]
    /** Drawing is always on (`alwaysDraw`, `onClick` for a press that does not draw); left out, nothing can be drawn. */
    annotations?: Annotations | undefined
    /** Makes the image a button that calls this (the enlarge dialog). */
    onEnlarge?: () => void
  }
}
