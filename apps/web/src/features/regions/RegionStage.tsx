import type { IgnoreRegion } from '@circi/api'
import { EnlargeTrigger } from '@circi/ui'
import { useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'

import { regionStyle } from './geometry.ts'
import { type Size, toFractions } from './ignore-regions.ts'
import { RegionLayer } from './RegionLayer.tsx'

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
 * beside it. With `drawing` on, a drag over the image draws a new region (the builds page's
 * `RegionLayer`, fractions of the image). With `onEnlarge` a click on the image (while not
 * drawing) asks for it to be shown large.
 */
export function RegionStage({
  name,
  latest,
  size,
  regions,
  drawing,
  onDrawingChange,
  onDraw,
  onEnlarge,
  pending,
}: RegionStage.Props) {
  const [loaded, setLoaded] = useState(false)
  const image = latest ? (
    <img
      src={fileUrl(latest.sha256)}
      alt={`${name} in build #${latest.buildNumber}`}
      className={styles.image}
      onLoad={() => setLoaded(true)}
    />
  ) : null
  return (
    <div className={styles.stage}>
      <div className={styles.shot} data-loaded={loaded ? '' : undefined}>
        {image && onEnlarge ? (
          <EnlargeTrigger label={`Enlarge ${name}`} onClick={onEnlarge}>
            {image}
          </EnlargeTrigger>
        ) : (
          image
        )}
        {size ? <RegionBoxes regions={regions} size={size} /> : null}
        {size ? (
          // Not drawing: the layer lets clicks through to the image (enlarge).
          <div className={styles.layer} data-idle={drawing ? undefined : ''}>
            <RegionLayer
              annotations={{
                threads: [],
                pending,
                focusedId: null,
                drawing,
                onDrawingChange,
                onDraw,
                onMarker: () => {},
              }}
            />
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
    drawing: boolean
    onDrawingChange: (drawing: boolean) => void
    onDraw: Parameters<typeof RegionLayer>[0]['annotations']['onDraw']
    /** Makes the image a button that calls this (the enlarge dialog). */
    onEnlarge?: () => void
    /** The region just drawn, while it is being saved. */
    pending: Parameters<typeof RegionLayer>[0]['annotations']['pending']
  }
}
