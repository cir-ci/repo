let last = 0

/**
 * A timestamp strictly later than the one before it (at least 1 ms apart), so rows seeded in a
 * row sort the way they were seeded even though they were inserted within the same instant.
 */
export function nextCreatedAt(): Date {
  last = Math.max(Date.now(), last + 1)
  return new Date(last)
}
