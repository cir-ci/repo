import { tokens } from './theme.js'

/** The hues a comment region can have, in the order they are handed out. */
export const REGION_HUES = [
  'blue',
  'orange',
  'green',
  'pink',
  'teal',
  'red',
  'violet',
  'yellow',
] as const satisfies readonly (keyof typeof tokens.region)[]

export type RegionHue = (typeof REGION_HUES)[number]

/**
 * The hue of the region with this number (1-based, the number on its pin and in its comment).
 * It follows the number, so the box, the pin and the comment always agree; the ninth region
 * starts the palette again (the number tells those apart).
 */
export function regionHue(number: number): RegionHue {
  const index =
    (((Math.trunc(number) - 1) % REGION_HUES.length) + REGION_HUES.length) % REGION_HUES.length
  return REGION_HUES[index] ?? 'blue'
}

/** The CSS color of region `number`: `var(--circi-region-blue)` and so on. */
export function regionColor(number: number): string {
  return tokens.region[regionHue(number)]
}
