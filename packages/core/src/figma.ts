/**
 * Figma links: reading a pasted Figma address, writing one back, and matching frames to
 * snapshots by name. Pure, so the dashboard, the services and the tests agree on every rule.
 */

export namespace parseFigmaUrl {
  export interface Result {
    fileKey: string
    /** `12:34` form, or null when the address points at the file as a whole. */
    nodeId: string | null
  }
}

const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com'])
const FIGMA_KIND = new Set(['design', 'file', 'proto', 'board', 'make', 'slides'])
const FILE_KEY_RE = /^[A-Za-z0-9]{10,40}$/
const NODE_ID_RE = /^\d+:\d+(?::\d+)*$/

/** A Figma node id from either spelling: `12-34` (in addresses) or `12:34` (in the API). */
export function normalizeNodeId(value: string): string | undefined {
  const id = value.trim().replace(/-/g, ':')
  return NODE_ID_RE.test(id) ? id : undefined
}

/**
 * The file key and node of a pasted Figma address: `figma.com/design/KEY/Name?node-id=12-34`
 * gives `{ fileKey: 'KEY', nodeId: '12:34' }`. A branch address (`/design/KEY/branch/BRANCH/…`)
 * is the branch's own file. Undefined for anything else.
 */
export function parseFigmaUrl(text: string): parseFigmaUrl.Result | undefined {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return undefined
  }
  if (!['https:', 'http:'].includes(url.protocol) || !FIGMA_HOSTS.has(url.hostname)) {
    return undefined
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const [kind, key, third, fourth] = parts
  if (!kind || !FIGMA_KIND.has(kind) || !key) return undefined
  const fileKey = third === 'branch' && fourth ? fourth : key
  if (!FILE_KEY_RE.test(fileKey)) return undefined
  const rawNode = url.searchParams.get('node-id')
  const nodeId = rawNode ? normalizeNodeId(rawNode) : undefined
  if (rawNode && !nodeId) return undefined
  return { fileKey, nodeId: nodeId ?? null }
}

/** A file key from either an address or the bare key. */
export function parseFigmaFileRef(text: string): string | undefined {
  const trimmed = text.trim()
  if (FILE_KEY_RE.test(trimmed)) return trimmed
  return parseFigmaUrl(trimmed)?.fileKey
}

/** The address that opens a frame (or the file) in Figma. */
export function figmaFrameUrl(fileKey: string, nodeId?: string | null): string {
  const base = `https://www.figma.com/design/${encodeURIComponent(fileKey)}`
  return nodeId ? `${base}?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}` : base
}

const SEPARATORS = /[\s/\\_-]+/g

/** A name for comparing: lower case, without spaces, slashes, dashes and underscores. */
export const normalizeFrameName = (name: string) => name.toLowerCase().replace(SEPARATORS, '')

export namespace matchFramesToSnapshots {
  export interface Match {
    snapshotName: string
    /** Index into the `frameNames` that were passed in. */
    frameIndex: number
    /** `exact`: the whole names are equal once normalised; `segment`: the frame is the last path part. */
    rule: 'exact' | 'segment'
  }
}

/**
 * Pairs snapshots with Figma frames by name. First the whole names, compared case-insensitively
 * and without separators (`Checkout / Cart` = `checkout-cart`); then, for snapshots left over, a
 * frame named like the snapshot's last path segment (`Cart` for `checkout/cart`).
 *
 * Never ambiguous: a snapshot that fits two frames equally gets no link, and neither does a
 * frame several leftover snapshots claim by their last segment. Exact matches always win a frame.
 */
export function matchFramesToSnapshots(
  frameNames: readonly string[],
  snapshotNames: readonly string[],
): matchFramesToSnapshots.Match[] {
  const frames = frameNames.map(normalizeFrameName)
  const framesNamed = (key: string) =>
    key === '' ? [] : frames.flatMap((f, i) => (f === key ? [i] : []))
  const snapshots = [...new Set(snapshotNames)]

  const out: matchFramesToSnapshots.Match[] = []
  const unmatched: string[] = []
  const exact = new Map<number, string[]>()
  for (const name of snapshots) {
    const hits = framesNamed(normalizeFrameName(name))
    const [only] = hits
    if (hits.length === 0) unmatched.push(name)
    else if (hits.length === 1 && only !== undefined) {
      exact.set(only, [...(exact.get(only) ?? []), name])
    }
  }
  const taken = new Set(exact.keys())
  for (const [frameIndex, names] of exact) {
    const [only] = names
    if (names.length === 1 && only !== undefined) {
      out.push({ snapshotName: only, frameIndex, rule: 'exact' })
    }
  }

  const claims = new Map<number, string[]>()
  for (const name of unmatched) {
    const last = name.split('/').findLast((s) => s.trim() !== '') ?? ''
    const hits = framesNamed(normalizeFrameName(last))
    const [only] = hits
    if (hits.length === 1 && only !== undefined && !taken.has(only)) {
      claims.set(only, [...(claims.get(only) ?? []), name])
    }
  }
  for (const [frameIndex, names] of claims) {
    const [only] = names
    if (names.length === 1 && only !== undefined) {
      out.push({ snapshotName: only, frameIndex, rule: 'segment' })
    }
  }
  return out
}

const wildcards = (pattern: string) => pattern.replaceAll(/[^*?]/g, '').length

export interface FigmaLinkLike {
  snapshotPattern: string
  source: string
}

/**
 * The link that applies to a snapshot when several patterns match: a manual link beats an
 * automatic one, then the pattern with fewer wildcards (the more specific), then the longer.
 */
export function pickFigmaLink<L extends FigmaLinkLike>(
  links: readonly L[],
  snapshotName: string,
  matches: (pattern: string, name: string) => boolean,
): L | undefined {
  return links
    .filter((l) => matches(l.snapshotPattern, snapshotName))
    .toSorted(
      (a, b) =>
        Number(b.source === 'manual') - Number(a.source === 'manual') ||
        wildcards(a.snapshotPattern) - wildcards(b.snapshotPattern) ||
        b.snapshotPattern.length - a.snapshotPattern.length,
    )[0]
}
