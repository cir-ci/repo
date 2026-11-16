import type { Build } from '@circi/api'
import { useEffect } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'

/** The steps from the shown screenshot that are warmed, nearest first: j goes on far more than k goes back. */
const STEPS = [1, -1, 2] as const
/** The shown screenshot gets the bandwidth first; the warming starts once it has had a moment. */
const START_DELAY_MS = 250
/** Addresses already warmed: the browser's cache has them, so they are not fetched again. */
const warmed = new Set<string>()
const MAX_WARMED = 200

/** What of a screenshot is warmed: its three images. */
interface Preloadable {
  id: string
  base: { sha256: string } | null
  head: { sha256: string } | null
  diff: { sha256: string } | null
}

/**
 * The files of the screenshots around `selected`, in the order j and k reach them (`ordered`),
 * nearest first: the next one's baseline, new and changed-pixels images, then the previous one's,
 * then the one after next. Addresses are the viewer's own (`fileUrl`, signed), so the browser
 * serves its cache entry when the screenshot opens.
 */
export function shotsToPreload(
  ordered: readonly Preloadable[],
  selected: Pick<Build.DiffItem, 'id'> | undefined,
  address: (sha256: string) => string = fileUrl,
): string[] {
  const at = selected ? ordered.findIndex((d) => d.id === selected.id) : -1
  if (at < 0) return []
  const urls: string[] = []
  for (const step of STEPS) {
    const d = ordered[at + step]
    if (!d) continue
    for (const image of [d.head, d.diff, d.base]) {
      if (image) urls.push(address(image.sha256))
    }
  }
  return [...new Set(urls)]
}

/** What an image is loaded through; `new Image()` in the browser. */
export interface Loader {
  fetchPriority: string
  decoding: string
  src: string
  decode: () => Promise<void>
}

/**
 * Loads each address in the background, one after another, at low priority, and decodes it so
 * showing it costs nothing. Returns a function that stops: images not started are skipped and the
 * ones in flight are dropped (their request is canceled where the browser allows). Addresses
 * already warmed are skipped.
 */
export function preloadImages(
  urls: readonly string[],
  create: () => Loader = () => new Image(),
): () => void {
  let stopped = false
  const inFlight = new Set<Loader>()
  const load = async (url: string) => {
    if (stopped || warmed.has(url)) return
    const image = create()
    image.fetchPriority = 'low'
    image.decoding = 'async'
    image.src = url
    inFlight.add(image)
    try {
      await image.decode()
      if (stopped) return
      if (warmed.size >= MAX_WARMED) warmed.clear()
      warmed.add(url)
    } catch {
      // A file that fails to load or decode is simply not warmed; the viewer shows its own error.
    } finally {
      inFlight.delete(image)
    }
  }
  // One at a time: warming must not compete with what the person is looking at.
  void urls.reduce((previous, url) => previous.then(() => load(url)), Promise.resolve())
  return () => {
    stopped = true
    // An empty source drops the request.
    for (const image of inFlight) image.src = ''
    inFlight.clear()
  }
}

/** Warms the screenshots next to the shown one (see `shotsToPreload`); leaving or moving on stops it. */
export function usePreloadShots(
  ordered: readonly Build.DiffItem[],
  selected: Build.DiffItem | undefined,
) {
  // The addresses as one string, so a refetch that changes nothing here doesn't restart the warming.
  const key = shotsToPreload(ordered, selected).join('\n')
  useEffect(() => {
    if (!key) return undefined
    const stops: (() => void)[] = []
    const timer = setTimeout(() => {
      stops.push(preloadImages(key.split('\n')))
    }, START_DELAY_MS)
    return () => {
      clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [key])
}

/** For tests: forgets what was warmed. */
export const forgetWarmed = () => warmed.clear()
