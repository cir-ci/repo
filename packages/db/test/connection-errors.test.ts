import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { createDb } from '#src/client.ts'

// A dropped Postgres connection is an `error` event: unhandled, Node re-throws it and the process
// exits (the server and the worker both died this way when Postgres went away under load). These
// drive the pool's own events; no database is needed, and none is connected to.
describe('a dropped database connection', () => {
  const url = 'postgres://nobody:nothing@127.0.0.1:1/none'

  it("is reported, not fatal, for an idle connection (the pool's error event)", async () => {
    const onConnectionError = vi.fn<(err: Error) => void>()
    const handle = createDb({ url, onConnectionError })
    const lost = new Error('Connection terminated unexpectedly')
    expect(() => handle.pool.emit('error', lost)).not.toThrow()
    expect(onConnectionError).toHaveBeenCalledWith(lost)
    await handle.pool.end()
  })

  it('is reported, not fatal, for a connection in use (its own error event)', async () => {
    const onConnectionError = vi.fn<(err: Error) => void>()
    const handle = createDb({ url, onConnectionError })
    // What the pool hands its `connect` listeners: a client, which is an event emitter.
    const client = new EventEmitter()
    handle.pool.emit('connect', client)
    const lost = new Error('Connection terminated unexpectedly')
    expect(() => client.emit('error', lost)).not.toThrow()
    expect(onConnectionError).toHaveBeenCalledWith(lost)
    await handle.pool.end()
  })

  it('is not fatal even with no one told', async () => {
    const handle = createDb({ url })
    const client = new EventEmitter()
    handle.pool.emit('connect', client)
    expect(() => handle.pool.emit('error', new Error('gone'))).not.toThrow()
    expect(() => client.emit('error', new Error('gone'))).not.toThrow()
    await handle.pool.end()
  })
})
