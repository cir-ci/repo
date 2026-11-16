import { IMAGE_CACHE } from '../sw/logic.ts'

/** The worker that is running, even for a page it doesn't control yet (a first load, a hard reload). */
async function activeWorker(): Promise<ServiceWorker | null> {
  const registration = await navigator.serviceWorker?.getRegistration()
  return registration?.active ?? navigator.serviceWorker?.controller ?? null
}

/**
 * Empties what the service worker keeps of screenshots (they are behind the session) and tells
 * the worker to forget its index and whose they were. Called when the session ends; quiet where
 * there is no worker.
 */
export async function forgetPrivateFiles(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(IMAGE_CACHE)
  } catch {
    // No Cache API: nothing was kept.
  }
  try {
    const worker = await activeWorker()
    // A worker has no target origin (it is this origin's own).
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker?.postMessage({ type: 'forget-private' })
  } catch {
    // No worker: nothing was kept.
  }
}

/**
 * Tells the worker who is signed in (the verified person), so it keeps screenshots as theirs and
 * serves them only to them; a different person than before empties what it holds.
 */
export function tellWorkerUser(userId: string): void {
  void activeWorker()
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    .then((worker) => worker?.postMessage({ type: 'user', id: userId }))
    .catch(() => undefined)
}
