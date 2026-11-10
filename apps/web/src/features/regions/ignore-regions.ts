import type { Comment, IgnoreRegion } from '@circi/api'

/** A snapshot's pixel size, as the latest screenshot reports it. */
export interface Size {
  width: number
  height: number
}

/** The size when both sides are known and positive. */
export function sizeOf(latest: IgnoreRegion.Snapshot['latest']): Size | null {
  if (!latest || !latest.width || !latest.height) return null
  return { width: latest.width, height: latest.height }
}

/** A stored region (pixels) as fractions of the screenshot, to draw over it at any size. */
export function toFractions(r: IgnoreRegion.Item, size: Size): Comment.Region {
  return {
    x: r.x / size.width,
    y: r.y / size.height,
    width: r.width / size.width,
    height: r.height / size.height,
  }
}

/** A drawn region (fractions) as the whole-number rectangle the server stores. */
export function toPixels(r: Comment.Region, size: Size) {
  const x = Math.min(size.width - 1, Math.round(r.x * size.width))
  const y = Math.min(size.height - 1, Math.round(r.y * size.height))
  return {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(r.width * size.width))),
    height: Math.max(1, Math.min(size.height - y, Math.round(r.height * size.height))),
  }
}

/** The regions of one screenshot name, newest first. */
export function regionsOf(regions: readonly IgnoreRegion.Item[], name: string) {
  return regions
    .filter((r) => r.name === name)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The screenshot to show: the one asked for, else the first with regions. */
export function pickSnapshot(snapshots: readonly IgnoreRegion.Snapshot[], wanted?: string) {
  return snapshots.find((s) => s.name === wanted) ?? snapshots[0]
}

export interface RectFields {
  x: string
  y: string
  width: string
  height: string
}

/** The box the Add dialog starts with: a quarter of the screenshot's size, in the middle. */
export function defaultRect(size: Size): Record<keyof RectFields, number> {
  const width = Math.max(1, Math.round(size.width / 4))
  const height = Math.max(1, Math.round(size.height / 4))
  return {
    x: Math.floor((size.width - width) / 2),
    y: Math.floor((size.height - height) / 2),
    width,
    height,
  }
}

/** The numbers typed into the form, or what is wrong with them; with `size`, the box must fit inside it. */
export function parseRect(
  fields: RectFields,
  size?: Size | null,
): { ok: true; rect: Record<keyof RectFields, number> } | { ok: false; error: string } {
  const nums = [fields.x, fields.y, fields.width, fields.height].map((raw) =>
    raw.trim() === '' ? Number.NaN : Number(raw),
  )
  const [x, y, width, height] = nums
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return { ok: false, error: 'Use whole numbers' }
  }
  if (!nums.every((n) => Number.isInteger(n))) return { ok: false, error: 'Use whole numbers' }
  if (x < 0 || y < 0 || width < 1 || height < 1) {
    return { ok: false, error: "Position can't be negative and size must be at least 1" }
  }
  if (size && (x + width > size.width || y + height > size.height)) {
    return {
      ok: false,
      error: `The region must fit inside the screenshot (${size.width}×${size.height})`,
    }
  }
  return { ok: true, rect: { x, y, width, height } }
}
