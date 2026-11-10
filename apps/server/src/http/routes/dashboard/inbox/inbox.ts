import type { Inbox } from '@circi/api'
import { type Notification } from '@circi/db'
import {
  countUnreadNotifications,
  getNotificationPreferences,
  INBOX_TABS,
  listInbox,
} from '@circi/db/queries'
import {
  markInboxRead,
  markNotificationRead,
  removeNotification,
  snoozeNotification,
  unsnoozeNotification,
  updateNotificationPreferences,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const idParams = z.object({ id: z.uuid() })
const listQuery = z.object({ tab: z.enum(INBOX_TABS).default('for-you') })
const readBody = z.object({ read: z.boolean() })
const snoozeBody = z.object({
  choice: z.enum(['tomorrow', 'next_week', 'date']),
  date: z.iso.datetime({ offset: true }).optional(),
})
const preferencesBody = z
  .object({ emailReviewRequested: z.boolean(), emailReviewOverdue: z.boolean() })
  .partial()
  .strict()

function state(n: Notification): Inbox.State {
  return {
    id: n.id,
    readAt: n.readAt?.toISOString() ?? null,
    snoozedUntil: n.snoozedUntil?.toISOString() ?? null,
  }
}

/**
 * The signed-in user's inbox. Every route is about the caller's own notifications only: someone
 * else's id is "not found", exactly like one that doesn't exist.
 */
export const dashboardInboxRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/inbox', async (req) => {
    const { tab } = parse(listQuery, req.query)
    const user = currentUser(req)
    const list = await listInbox(deps.db, {
      userId: user.id,
      tab,
      now: new Date(),
      method: user.method,
    })
    const payload: Inbox.List = {
      ...list,
      items: list.items.map((i) =>
        Object.assign({}, i, {
          createdAt: i.createdAt.toISOString(),
          readAt: i.readAt?.toISOString() ?? null,
          snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
          request: i.request
            ? { dueAt: i.request.dueAt?.toISOString() ?? null, overdueByMs: i.request.overdueByMs }
            : null,
        }),
      ),
    }
    return payload
  })

  app.get('/inbox/unread-count', async (req) => {
    const user = currentUser(req)
    const payload: Inbox.UnreadCount = {
      unread: await countUnreadNotifications(deps.db, {
        userId: user.id,
        now: new Date(),
        method: user.method,
      }),
    }
    return payload
  })

  app.post('/inbox/read-all', async (req) => {
    const marked = await markInboxRead(deps.db, currentUser(req).id)
    return { marked }
  })

  app.get('/inbox/preferences', async (req) => {
    const payload: Inbox.Preferences = await getNotificationPreferences(
      deps.db,
      currentUser(req).id,
    )
    return payload
  })

  app.put('/inbox/preferences', async (req) => {
    const changes = parse(preferencesBody, req.body)
    const payload: Inbox.Preferences = await updateNotificationPreferences(
      deps.db,
      currentUser(req).id,
      changes,
    )
    return payload
  })

  app.post('/inbox/:id/read', async (req) => {
    const { id } = parse(idParams, req.params)
    const { read } = parse(readBody, req.body)
    return state(await markNotificationRead(deps.db, { userId: currentUser(req).id, id, read }))
  })

  app.post('/inbox/:id/snooze', async (req) => {
    const { id } = parse(idParams, req.params)
    const { choice, date } = parse(snoozeBody, req.body)
    return state(
      await snoozeNotification(deps.db, {
        userId: currentUser(req).id,
        id,
        choice,
        ...(date ? { date: new Date(date) } : {}),
      }),
    )
  })

  app.post('/inbox/:id/unsnooze', async (req) => {
    const { id } = parse(idParams, req.params)
    return state(await unsnoozeNotification(deps.db, { userId: currentUser(req).id, id }))
  })

  app.delete('/inbox/:id', async (req, reply) => {
    const { id } = parse(idParams, req.params)
    await removeNotification(deps.db, { userId: currentUser(req).id, id })
    return reply.code(204).send()
  })
}
