import type { CirciParameters, circiStorybook } from './types.ts'
import { parseViewport, record } from './viewports.ts'

const KNOWN = new Set(['skip', 'viewports', 'delay', 'selector', 'padding'])

/** Checks a story's `parameters.circi`; the message says what is wrong, so the story can fail with it. */
export function parseCirciParameters(raw: unknown): CirciParameters {
  if (raw === undefined || raw === null) return {}
  const value = record(raw)
  if (!value) throw new Error('parameters.circi must be an object')
  const unknown = Object.keys(value).filter((key) => !KNOWN.has(key))
  if (unknown.length > 0) {
    throw new Error(`parameters.circi has unknown ${unknown.map((k) => `"${k}"`).join(', ')}`)
  }
  const out: CirciParameters = {}
  if (value.skip !== undefined) {
    if (typeof value.skip !== 'boolean') {
      throw new Error('parameters.circi.skip must be true or false')
    }
    out.skip = value.skip
  }
  if (value.selector !== undefined) {
    if (typeof value.selector !== 'string' || !value.selector.trim()) {
      throw new Error('parameters.circi.selector must be a CSS selector')
    }
    out.selector = value.selector
  }
  for (const key of ['delay', 'padding'] as const) {
    const n = value[key]
    if (n === undefined) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new Error(`parameters.circi.${key} must be a number of 0 or more`)
    }
    out[key] = n
  }
  if (value.viewports !== undefined) {
    if (!Array.isArray(value.viewports) || value.viewports.length === 0) {
      throw new Error('parameters.circi.viewports must be a list of viewports, such as ["390x844"]')
    }
    const list: circiStorybook.Viewport[] = []
    for (const viewport of value.viewports) {
      const size = parseViewport(viewport)
      list.push(size.name ? { name: size.name, width: size.width, height: size.height } : size)
    }
    out.viewports = list
  }
  return out
}
