import type { Push } from '@circi/api'
import { listPushDevices } from '@circi/db/queries'
import { getVapidKeys, removePushDevice, subscribePush, unsubscribePush } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const idParams = z.object({ id: z.uuid() })
const subscribeBody = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
})
const unsubscribeBody = z.object({ endpoint: z.url().max(2048) })

/**
 * Web push for the signed-in user: the server's public key, their devices, and turning the
 * browser they are on on or off. Every route is about the caller's own devices only.
 */
export const dashboardPushRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const devices = async (userId: string): Promise<Push.Devices> => ({
    devices: (await listPushDevices(deps.db, userId)).map((d) => ({
      id: d.id,
      endpoint: d.endpoint,
      label: d.label,
      createdAt: d.createdAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    })),
  })

  app.get('/push/public-key', async (_req, reply) => {
    if (!deps.authSecret) return reply.code(501).send({ error: "Web push isn't available" })
    const keys = await getVapidKeys(deps.db, { authSecret: deps.authSecret, fromEnv: deps.vapid })
    const payload: Push.PublicKey = { publicKey: keys.publicKey }
    return payload
  })

  app.get('/push/devices', async (req) => devices(currentUser(req).id))

  app.post('/push/subscribe', async (req) => {
    const body = parse(subscribeBody, req.body)
    const userId = currentUser(req).id
    await subscribePush(deps.db, {
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers['user-agent'] ?? null,
      allowPrivate: deps.webhookAllowPrivate === true,
    })
    return devices(userId)
  })

  app.post('/push/unsubscribe', async (req) => {
    const { endpoint } = parse(unsubscribeBody, req.body)
    await unsubscribePush(deps.db, { userId: currentUser(req).id, endpoint })
    return { ok: true }
  })

  app.delete('/push/devices/:id', async (req) => {
    const { id } = parse(idParams, req.params)
    const userId = currentUser(req).id
    await removePushDevice(deps.db, { userId, id })
    return devices(userId)
  })
}
