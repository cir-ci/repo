import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { PoolRequest, PoolResponse } from '#src/pool-worker.ts'

/**
 * The thread pool behind the `js-workers` engine: pixelmatch in `node:worker_threads` workers,
 * so concurrent comparisons use several cores instead of queueing on the event loop.
 *
 * - Lazy: no thread exists until the first comparison; the pool is then reused.
 * - Inputs are copied into the worker (structured clone), not transferred: the caller keeps its
 *   buffers, and a crashed worker can be answered by running the comparison in-thread. The diff
 *   image the worker draws is its own allocation, so that one is transferred back, not copied.
 * - A worker that dies or can't start fails only the calls it held (`PoolUnavailableError`); the
 *   caller falls back to the in-thread path. After repeated crashes the pool gives up for good.
 */
export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PoolUnavailableError'
  }
}

/** Where the worker script may be: next to the server bundle (the image), or next to this source file. */
const SCRIPT_CANDIDATES = [
  new URL('./pool-worker.mjs', import.meta.url),
  new URL('./pool-worker.ts', import.meta.url),
]

export function findWorkerScript(): URL | undefined {
  return SCRIPT_CANDIDATES.find((u) => existsSync(fileURLToPath(u)))
}

export function defaultThreads(): number {
  return Math.max(1, availableParallelism() - 1)
}

/** Crashes before the pool stops respawning and every call runs in-thread. */
const MAX_FAILURES = 5

export interface PoolResult {
  changedPixels: number
  output?: Uint8Array
}

interface Pending {
  resolve(result: PoolResult): void
  reject(error: Error): void
}

interface Slot {
  worker: Worker
  current?: number
}

export class DiffPool {
  private readonly slots: Slot[] = []
  private readonly idle: Slot[] = []
  private readonly queue: { request: PoolRequest; pending: Pending }[] = []
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private failures = 0
  private broken: string | undefined
  private closed = false

  private readonly size: number
  private readonly script: URL | undefined
  private readonly warn: (message: string) => void

  constructor(size: number, script: URL | undefined, warn: (message: string) => void) {
    this.size = size
    this.script = script
    this.warn = warn
  }

  get threads(): number {
    return this.size
  }

  compare(request: Omit<PoolRequest, 'id'>): Promise<PoolResult> {
    if (this.closed) return Promise.reject(new PoolUnavailableError('the pool is closed'))
    if (!this.script) {
      return Promise.reject(
        new PoolUnavailableError('the worker script (pool-worker) was not found'),
      )
    }
    if (this.broken) return Promise.reject(new PoolUnavailableError(this.broken))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.queue.push({
        // Plain copies: a Buffer's bytes may sit in a shared slab, and the caller keeps its own.
        request: { ...request, id, a: new Uint8Array(request.a), b: new Uint8Array(request.b) },
        pending: { resolve, reject },
      })
      this.pump()
    })
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const slot = this.idle.pop() ?? this.spawn()
      // Nothing idle and no room for another thread: wait for one to finish.
      if (!slot) return
      const next = this.queue.shift()
      if (!next) {
        this.idle.push(slot)
        return
      }
      slot.current = next.request.id
      this.pending.set(next.request.id, next.pending)
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker thread, not a window
      slot.worker.postMessage(next.request)
    }
  }

  private spawn(): Slot | undefined {
    if (this.slots.length >= this.size || !this.script || this.broken) return undefined
    let worker: Worker
    try {
      worker = new Worker(this.script)
    } catch (err) {
      this.giveUp(
        `a worker thread can't start (${err instanceof Error ? err.message : String(err)})`,
      )
      return undefined
    }
    // An idle pool must not keep the process alive.
    worker.unref()
    const slot: Slot = { worker }
    this.slots.push(slot)
    worker.on('message', (res: PoolResponse) => {
      const pending = this.pending.get(res.id)
      this.pending.delete(res.id)
      slot.current = undefined
      this.idle.push(slot)
      if (pending) {
        if ('error' in res) {
          pending.reject(new PoolUnavailableError(`a worker failed: ${res.error}`))
        } else {
          pending.resolve({
            changedPixels: res.changedPixels,
            ...(res.output ? { output: res.output } : {}),
          })
        }
      }
      this.pump()
    })
    const lost = (reason: string) => {
      const at = this.slots.indexOf(slot)
      if (at < 0) return
      this.slots.splice(at, 1)
      const idleAt = this.idle.indexOf(slot)
      if (idleAt >= 0) this.idle.splice(idleAt, 1)
      if (slot.current !== undefined) {
        const held = this.pending.get(slot.current)
        this.pending.delete(slot.current)
        held?.reject(new PoolUnavailableError(reason))
      }
      if (this.closed) return
      this.failures += 1
      if (this.failures >= MAX_FAILURES) this.giveUp(reason)
      else this.pump()
    }
    worker.on('error', (err: Error) => lost(`a worker thread crashed (${err.message})`))
    worker.on('exit', (code) => lost(`a worker thread exited (code ${code})`))
    return slot
  }

  private giveUp(reason: string): void {
    if (!this.broken) {
      this.broken = `${reason}; the pool is off`
      this.warn(`js-workers diff pool: ${this.broken}, comparing in-thread instead`)
    }
    this.failQueue(this.broken)
  }

  private failQueue(reason: string): void {
    for (const { pending } of this.queue.splice(0)) {
      pending.reject(new PoolUnavailableError(reason))
    }
  }

  /** Stops every thread; calls still waiting fail (and run in-thread at their callers). */
  async close(): Promise<void> {
    this.closed = true
    this.failQueue('the pool is closed')
    for (const [, held] of this.pending) held.reject(new PoolUnavailableError('the pool is closed'))
    this.pending.clear()
    const slots = this.slots.splice(0)
    this.idle.length = 0
    await Promise.all(slots.map((s) => s.worker.terminate()))
  }
}
