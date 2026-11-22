import type { QueryClient } from '@tanstack/react-query'
import { expect } from 'vitest'

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

/**
 * Waits until what the page has already been told to do has happened: no query or mutation of the
 * client is in flight and two frames have passed (renders, effects, event handlers queued by them).
 * It is what a negative assertion ("nothing was sent", "still closed") runs after instead of a
 * fixed sleep: a thing that was going to happen has happened by then.
 */
export async function settled(queryClient?: QueryClient): Promise<void> {
  await frame()
  if (queryClient) {
    await expect
      .poll(() => queryClient.isFetching() + queryClient.isMutating(), { timeout: 5_000 })
      .toBe(0)
  }
  await frame()
}
