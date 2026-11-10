/**
 * `NumberField` holds a number (or null when empty); the settings forms keep what was typed as
 * text, so their validation ("Enter a whole number") stays as it was. These two convert.
 */
export function numberOf(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export const textOf = (value: number | null): string => (value === null ? '' : String(value))
