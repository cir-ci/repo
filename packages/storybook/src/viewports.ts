import type { circiStorybook } from './types.ts'

export interface Size {
  name?: string
  width: number
  height: number
}

/** Reads a viewport as the options and `parameters.circi.viewports` write it; throws what is wrong. */
export function parseViewport(viewport: unknown): Size {
  if (typeof viewport === 'string') {
    const match = /^(?:([\w-]+)=)?(\d+)x(\d+)$/i.exec(viewport.trim())
    if (!match) {
      throw new Error(`Viewport "${viewport}" must look like 1280x720 or mobile=390x844`)
    }
    const [, name, width, height] = match
    const size = { width: Number(width), height: Number(height) }
    if (!validSize(size.width, size.height)) {
      throw new Error(`Viewport "${viewport}" needs a width and height of at least 1`)
    }
    return name ? { name, ...size } : size
  }
  const object = record(viewport)
  const width = object?.width
  const height = object?.height
  if (typeof width !== 'number' || typeof height !== 'number' || !validSize(width, height)) {
    throw new Error(`Viewport ${JSON.stringify(viewport)} needs a width and height in pixels`)
  }
  const name = object?.name
  return typeof name === 'string' && name ? { name, width, height } : { width, height }
}

function validSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
}

/** What names a viewport in a screenshot's name and metadata: its name, or `1280x720`. */
export function viewportLabel(size: Size): string {
  return size.name ?? `${size.width}x${size.height}`
}

export function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
}

export function asViewports(list: readonly circiStorybook.Viewport[]): Size[] {
  return list.map((viewport) => parseViewport(viewport))
}

/** The sizes the Viewport addon ships without being configured. */
const BUILT_IN: Record<string, Size> = {
  mobile1: { name: 'mobile1', width: 320, height: 568 },
  mobile2: { name: 'mobile2', width: 414, height: 896 },
  tablet: { name: 'tablet', width: 834, height: 1112 },
}

/**
 * The viewport a story chose with Storybook's Viewport addon, or undefined: `globals.viewport`
 * (Storybook 9 and later, a name or `{ value }`) or `parameters.viewport.defaultViewport`
 * (Storybook 8), looked up in `parameters.viewport.options` / `.viewports`, then the addon's
 * built-in sizes. Sizes in px only.
 */
export function storyViewport(story: {
  parameters?: unknown
  globals?: unknown
}): Size | undefined {
  const param = record(record(story.parameters)?.viewport)
  const chosen = record(story.globals)?.viewport
  const fromGlobals = typeof chosen === 'string' ? chosen : stringOf(record(chosen)?.value)
  const key = fromGlobals ?? stringOf(param?.defaultViewport)
  if (!key || key === 'reset') return undefined
  const table = record(param?.options) ?? record(param?.viewports)
  const styles = record(record(table?.[key])?.styles)
  const width = px(styles?.width)
  const height = px(styles?.height)
  if (width && height) return { name: key, width, height }
  return BUILT_IN[key]
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function px(value: unknown): number | undefined {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)px$/.exec(value.trim()) : undefined
  return match?.[1] ? Math.round(Number(match[1])) : undefined
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}
