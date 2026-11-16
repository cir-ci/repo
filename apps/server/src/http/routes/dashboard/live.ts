import type { LiveNotice } from '@circi/core'
import { getLiveScope, getSessionAccess } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { createLiveHub, liveEventFor } from '#http/lib/live-hub.ts'

/** How often a quiet stream says it is alive, and looks again at the session and what the person may see. */
const HEARTBEAT_MS = 25_000
/** Tells the browser how long to wait before it reconnects. */
const RETRY_MS = 5_000
/** At most this often a notice about an unknown project reloads the person's scope (a flood of new projects must not flood the database). */
const SCOPE_RELOAD_MIN_MS = 5_000
/** Streams one server process keeps open, unless configured (`LIVE_MAX_STREAMS`). */
const DEFAULT_MAX_STREAMS = 2000
/** Streams one person may keep open; a new one ends the oldest. */
const DEFAULT_MAX_PER_USER = 5
/** A stream whose unsent output grows past this is a client that doesn't read: it is ended. */
const MAX_BUFFERED_BYTES = 64 * 1024
/** Project IDs remembered as not the person's (cleared at each scope reload). */
const MAX_UNKNOWN_PROJECTS = 500
/** What a refused client is told to wait. */
const BUSY_RETRY_SECONDS = 10

/**
 * `GET /api/live`: server-sent events for the signed-in dashboard (`Live.Event`, IDs and slugs only).
 *
 * Every change the services commit is a Postgres NOTIFY that every server instance hears
 * (`createLiveHub`); this connection turns each into an event if the person may see it. A heartbeat
 * every 25 seconds keeps proxies from closing a quiet stream and ends it once the session is
 * gone; access changes arrive as notices (`access.changed`, `session.ended`) and act at once, the
 * heartbeat is the backstop. Without the database feed the stream is refused (503), so the
 * dashboard knows to poll slowly instead. A person keeps a few streams (the oldest is ended for
 * a new one) and the process a bounded number (503 with Retry-After beyond it).
 */
export const dashboardLiveRoutes: FastifyPluginAsync<Deps.Dashboard> = async (api, deps) => {
  const live = deps.live
  if (!live) return
  const hub = createLiveHub({ listen: live.listen, logger: api.log })
  api.addHook('onClose', () => hub.close())
  const heartbeatMs = live.heartbeatMs ?? HEARTBEAT_MS
  const maxStreams = live.maxStreams ?? DEFAULT_MAX_STREAMS
  const maxPerUser = live.maxPerUser ?? DEFAULT_MAX_PER_USER
  const reloadMinMs = live.scopeReloadMinMs ?? SCOPE_RELOAD_MIN_MS

  /** Every stream of this process, including those still starting, oldest first per person. */
  const byUser = new Map<string, Set<() => void>>()
  let total = 0
  live.onStats?.({ streams: () => total, subscribers: () => hub.subscribers() })
  const register = (userId: string, end: () => void): (() => void) => {
    // Evict first: an evicted stream's `end` releases it, which may drop the person's set.
    for (let set = byUser.get(userId); set && set.size >= maxPerUser; set = byUser.get(userId)) {
      const [oldest] = set
      if (!oldest) break
      oldest()
      set.delete(oldest)
    }
    let set = byUser.get(userId)
    if (!set) {
      set = new Set()
      byUser.set(userId, set)
    }
    set.add(end)
    total += 1
    let released = false
    return () => {
      if (released) return
      released = true
      total -= 1
      const mine = byUser.get(userId)
      mine?.delete(end)
      if (mine?.size === 0) byUser.delete(userId)
    }
  }

  api.get('/live', async (req, reply) => {
    const user = currentUser(req)
    if (total >= maxStreams) {
      return reply
        .code(503)
        .header('retry-after', String(BUSY_RETRY_SECONDS))
        .send({ error: 'Too many live streams are open right now' })
    }
    const res = reply.raw
    let ended = false
    let hijacked = false
    let timer: NodeJS.Timeout | undefined
    let unsubscribe: (() => void) | undefined
    const end = (): void => {
      if (ended) return
      ended = true
      if (timer) clearInterval(timer)
      unsubscribe?.()
      release()
      if (hijacked && !res.writableEnded) res.end()
    }
    // Registered, and watching for the client to leave, before the first await: a client that
    // goes away while the hub or the scope loads must not leave a stream behind.
    const release = register(user.id, end)
    res.on('close', end)

    try {
      if (!(await hub.ready())) {
        end()
        return reply.code(503).send({ error: 'Live updates are not available right now' })
      }
      const load = () => getLiveScope(deps.db, { userId: user.id, method: user.method })
      let scope = await load()
      let loadedAt = Date.now()
      if (ended || res.destroyed) {
        end()
        return reply
      }

      reply.hijack()
      hijacked = true
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // nginx-style proxies buffer unless told not to.
        'x-accel-buffering': 'no',
      })
      res.write(`retry: ${RETRY_MS}\n\n`)

      // One notice at a time, in order; a reload of the scope waits its turn too.
      let queue: Promise<void> = Promise.resolve()
      const enqueue = (work: () => Promise<void>): void => {
        queue = queue.then(work).catch((err: unknown) => api.log.warn({ err }, 'live stream step'))
      }
      const write = (chunk: string): void => {
        if (ended) return
        if (res.destroyed || res.writableEnded) return end()
        // A client that doesn't read would grow this process's memory: end it, it reconnects.
        if (res.writableLength > MAX_BUFFERED_BYTES) return end()
        res.write(chunk)
        return undefined
      }
      const send = (event: object): void => write(`data: ${JSON.stringify(event)}\n\n`)

      const notFor = new Set<string>()
      const reload = async (): Promise<void> => {
        scope = await load()
        loadedAt = Date.now()
        notFor.clear()
      }

      const onNotice = async (notice: LiveNotice): Promise<void> => {
        if (ended) return
        if (notice.type === 'session.ended') {
          if (notice.userId === user.id && notice.sessionId === user.sessionId) end()
          return
        }
        if (notice.type === 'access.changed') {
          if (notice.userId === user.id) await reload()
          return
        }
        // A workspace the person isn't in: nothing to say and nothing to load.
        if (
          'projectId' in notice &&
          notice.workspaceId !== undefined &&
          !scope.workspaces.some((w) => w.id === notice.workspaceId)
        ) {
          return
        }
        if ('projectId' in notice && notFor.has(notice.projectId)) return
        let found = liveEventFor(notice, user.id, scope)
        if (found === 'unknown-project' && Date.now() - loadedAt >= reloadMinMs) {
          await reload()
          found = liveEventFor(notice, user.id, scope)
          if (found === 'unknown-project' && 'projectId' in notice) {
            if (notFor.size >= MAX_UNKNOWN_PROJECTS) notFor.clear()
            notFor.add(notice.projectId)
          }
        }
        if (found !== undefined && found !== 'unknown-project') send(found)
      }

      const beat = async (): Promise<void> => {
        if (ended) return
        if (res.destroyed || res.writableEnded) return end()
        if (!hub.up()) return end()
        write(': ping\n\n')
        const access = await getSessionAccess(deps.db, {
          sessionId: user.sessionId,
          userId: user.id,
        })
        // Signed out, revoked or banned: the next connection gets the 401 and the app shows sign-in.
        if (!access) return end()
        await reload()
        return undefined
      }

      unsubscribe = hub.subscribe({
        notice: (notice) => enqueue(() => onNotice(notice)),
        end,
      })
      timer = setInterval(() => enqueue(beat), heartbeatMs)
      timer.unref()
      return reply
    } catch (err) {
      end()
      throw err
    }
  })
}
