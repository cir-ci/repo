import type { Live } from '@circi/api'

import { sleep } from '#fakes/http.ts'

import type { Session } from './admin.ts'
import { clientAddressHeaders } from './client-address.ts'

export interface LiveEvent {
  event: Live.Event
  /** `performance.now()` when the chunk carrying it arrived. */
  at: number
}

/**
 * A client of `GET /api/live` (server-sent events), as the dashboard's `EventSource` is, but
 * with timestamps: it keeps every event and every comment line (`: ping` heartbeats) with the
 * time its bytes arrived, so tests can tell "unbuffered" from "delivered late in a burst".
 * `base` defaults to the session's own address; pass another (a second server process, a proxy)
 * to read the stream from there with the same cookie.
 */
export class LiveStream {
  readonly events: LiveEvent[] = []
  /** Arrival times of comment lines (`: ping`). */
  readonly comments: number[] = []
  /** The stream is over (the server ended it, or `close()` was called). */
  ended = false
  /** The raw text received, for failure messages. */
  raw = ''
  #done: Promise<void> = Promise.resolve()

  readonly status: number
  readonly headers: Headers
  /** Body of a refused request (not a stream). */
  readonly refusal: string | undefined
  readonly #abort: AbortController

  private constructor(
    status: number,
    headers: Headers,
    refusal: string | undefined,
    abort: AbortController,
  ) {
    this.status = status
    this.headers = headers
    this.refusal = refusal
    this.#abort = abort
  }

  /** Opens the stream and resolves once the response headers are in (the server has registered it). */
  static async open(
    session: Session,
    options: { base?: string; path?: string } = {},
  ): Promise<LiveStream> {
    const abort = new AbortController()
    const res = await fetch(`${options.base ?? session.url}${options.path ?? '/api/live'}`, {
      headers: {
        ...clientAddressHeaders(session.address),
        cookie: session.cookieHeader,
        accept: 'text/event-stream',
      },
      signal: abort.signal,
    })
    const streaming = res.status === 200
    const stream = new LiveStream(
      res.status,
      res.headers,
      streaming ? undefined : await res.text(),
      abort,
    )
    if (!streaming) {
      stream.ended = true
      return stream
    }
    stream.#done = stream.#read(res.body)
    return stream
  }

  async #read(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) {
      this.ended = true
      return
    }
    const decoder = new TextDecoder()
    let pending = ''
    try {
      const reader = body.getReader()
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- reading a stream is sequential
        const { done, value } = await reader.read()
        if (done) break
        const at = performance.now()
        const text = decoder.decode(value, { stream: true })
        this.raw += text
        pending += text
        for (let cut = pending.indexOf('\n\n'); cut >= 0; cut = pending.indexOf('\n\n')) {
          this.#message(pending.slice(0, cut), at)
          pending = pending.slice(cut + 2)
        }
      }
    } catch {
      // aborted or reset: the stream is over either way
    }
    this.ended = true
  }

  #message(block: string, at: number): void {
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) this.comments.push(at)
      else if (line.startsWith('data:')) {
        this.events.push({ event: JSON.parse(line.slice(5).trim()) as Live.Event, at })
      }
    }
  }

  /** The events of one type heard so far. */
  of(type: Live.EventType): LiveEvent[] {
    return this.events.filter((e) => e.event.type === type)
  }

  /** Resolves with the first event (from now on or already heard) that `match` accepts; rejects after `timeoutMs`. */
  async waitFor(match: (event: Live.Event) => boolean, timeoutMs = 20_000): Promise<LiveEvent> {
    const deadline = performance.now() + timeoutMs
    for (;;) {
      const found = this.events.find((e) => match(e.event))
      if (found) return found
      if (performance.now() > deadline) {
        throw new Error(
          `no matching live event within ${timeoutMs} ms; heard ${JSON.stringify(this.events.map((e) => e.event))}`,
        )
      }
      // oxlint-disable-next-line no-await-in-loop -- polling
      await sleep(20)
    }
  }

  /** Resolves when the stream is over; rejects after `timeoutMs`. */
  async waitForEnd(timeoutMs = 10_000): Promise<void> {
    const deadline = performance.now() + timeoutMs
    while (!this.ended) {
      if (performance.now() > deadline)
        throw new Error(`the stream did not end within ${timeoutMs} ms`)
      // oxlint-disable-next-line no-await-in-loop -- polling
      await sleep(20)
    }
    await this.#done
  }

  close(): void {
    this.#abort.abort()
  }
}
