/** `fn` over `items`, at most `limit` at a time; results keep the order of `items`. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length })
  // One iterator shared by the lanes: each pulls the next item when it is free.
  const pending = items.entries()
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [index, item] of pending) {
      // oxlint-disable-next-line no-await-in-loop -- each lane takes one item at a time
      results[index] = await fn(item)
    }
  })
  await Promise.all(lanes)
  return results
}
