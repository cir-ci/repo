/** The viewer's zoom: fit the width (never scaled up past 100%) or a percentage of the real size. */
export type Zoom = 'fit' | number

export const ZOOM_STEPS: readonly number[] = [25, 50, 75, 100, 150, 200, 300, 400]

/** One step in or out. From "fit", in goes to 100% and out to 50%; the ends stay put. */
export function stepZoom(current: Zoom, direction: 1 | -1): number {
  const first = ZOOM_STEPS[0] ?? 25
  const last = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 400
  if (current === 'fit') return direction === 1 ? 100 : 50
  const next =
    direction === 1 ? ZOOM_STEPS.find((s) => s > current) : ZOOM_STEPS.findLast((s) => s < current)
  return next ?? (direction === 1 ? last : first)
}

export const zoomLabel = (zoom: Zoom): string => (zoom === 'fit' ? 'Fit' : `${zoom}%`)

/**
 * The width to draw an image at, in px, or undefined to let it fit its container. Without the
 * image's real width there is nothing to scale from, so it fits.
 */
export function zoomedWidth(
  zoom: Zoom,
  naturalWidth: number | null | undefined,
): number | undefined {
  if (zoom === 'fit' || !naturalWidth) return undefined
  return Math.round((naturalWidth * zoom) / 100)
}
