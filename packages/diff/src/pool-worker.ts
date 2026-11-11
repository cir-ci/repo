import { parentPort } from 'node:worker_threads'

import pixelmatch from 'pixelmatch'

/**
 * The worker-thread side of the `js-workers` engine: runs pixelmatch for one request at a time.
 * Keep this file self-contained (no `#src` aliases, no TypeScript-only syntax that needs a
 * transform): Node runs it directly from source, and the server bundle emits it as its own file.
 */
export interface PoolRequest {
  id: number
  a: Uint8Array
  b: Uint8Array
  width: number
  height: number
  threshold: number
  alpha: number
  withOutput: boolean
}

export type PoolResponse =
  | { id: number; changedPixels: number; output?: Uint8Array }
  | { id: number; error: string }

const port = parentPort
if (!port) throw new Error('pool-worker must run as a worker thread')

port.on('message', (req: PoolRequest) => {
  try {
    const output = req.withOutput ? new Uint8Array(req.width * req.height * 4) : undefined
    const changedPixels = pixelmatch(req.a, req.b, output, req.width, req.height, {
      threshold: req.threshold,
      includeAA: false,
      alpha: req.alpha,
    })
    const res: PoolResponse = { id: req.id, changedPixels, ...(output ? { output } : {}) }
    // The output buffer is the worker's own: hand it over instead of copying it.
    port.postMessage(res, output ? [output.buffer] : [])
  } catch (err) {
    const res: PoolResponse = {
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    }
    port.postMessage(res)
  }
})
