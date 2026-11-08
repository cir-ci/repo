import type { IgnoreRegion } from '@circi/api'
import { useState } from 'react'

import { fileUrl } from '#features/builds/api.ts'
import { RegionLayer } from '#features/builds/RegionLayer.tsx'
import { regionStyle } from '#features/builds/regions.ts'

import { type Size, toFractions } from './ignore-regions.ts'

import styles from './RegionStage.module.css'

/**
 * The latest screenshot of one name with its ignore regions drawn over it, numbered like the list
 * beside it. With `drawing` on, a drag over the image draws a new region (the builds page's
 * `RegionLayer`, fractions of the image).
 */
export function RegionStage({
  name,
  latest,
  size,
  regions,
  drawing,
  onDrawingChange,
  onDraw,
  pending,
}: RegionStage.Props) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={styles.stage}>
      <div className={styles.shot} data-loaded={loaded ? '' : undefined}>
        {latest ? (
          <img
            src={fileUrl(latest.sha256)}
            alt={`${name} in build #${latest.buildNumber}`}
            className={styles.image}
            onLoad={() => setLoaded(true)}
          />
        ) : null}
        {size
          ? regions.map((r, index) => (
              <span key={r.id} className={styles.region} style={regionStyle(toFractions(r, size))}>
                <span className={styles.tag} aria-hidden="true">
                  {index + 1}
                </span>
              </span>
            ))
          : null}
        {size ? (
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
        ) : null}
      </div>
    </div>
  )
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
    /** The region just drawn, while it is being saved. */
    pending: Parameters<typeof RegionLayer>[0]['annotations']['pending']
  }
}
