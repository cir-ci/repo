/** A screenshot as far as pairing is concerned. */
export interface PairableScreenshot {
  id: string
  name: string
  fileSha256: string
}

export type ScreenshotPair<S extends PairableScreenshot = PairableScreenshot> =
  | { status: 'added'; name: string; head: S }
  | { status: 'removed'; name: string; base: S }
  /** Byte-identical: no pixel diff needed (PLAN §7.3). */
  | { status: 'unchanged'; name: string; head: S; base: S }
  /** Same name, different bytes: needs a pixel diff to decide changed vs unchanged. */
  | { status: 'compare'; name: string; head: S; base: S }

/** Pairs head and base screenshots by name, sorted by name for stable output. */
export function pairScreenshots<S extends PairableScreenshot>(
  head: readonly S[],
  base: readonly S[],
): ScreenshotPair<S>[] {
  const baseByName = new Map(base.map((s) => [s.name, s]))
  const pairs: ScreenshotPair<S>[] = []
  for (const h of head) {
    const b = baseByName.get(h.name)
    if (!b) pairs.push({ status: 'added', name: h.name, head: h })
    else {
      pairs.push(
        b.fileSha256 === h.fileSha256
          ? { status: 'unchanged', name: h.name, head: h, base: b }
          : { status: 'compare', name: h.name, head: h, base: b },
      )
      baseByName.delete(h.name)
    }
  }
  for (const b of baseByName.values()) pairs.push({ status: 'removed', name: b.name, base: b })
  return pairs.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
