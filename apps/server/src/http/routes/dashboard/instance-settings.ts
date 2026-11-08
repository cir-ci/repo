import type { InstanceAdmin } from '@circi/api'
import type { FastifyPluginAsync } from 'fastify'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { describeSettings } from '#http/lib/instance-settings.ts'

/** `/api/instance/settings` and `/api/instance/mail/test`: read-only, from the environment. */
export const dashboardInstanceSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  app.get('/instance/settings', async (_req, reply) => {
    if (!deps.instance)
      return reply.code(501).send({ error: 'Instance settings are not available' })
    const settings: InstanceAdmin.Settings = describeSettings(deps.instance, deps)
    return settings
  })

  /** Sends a test mail to the signed-in admin's own address; the outcome is in the body. */
  app.post('/instance/mail/test', async (req): Promise<InstanceAdmin.MailTest> => {
    const to = currentUser(req).email
    const mailer = deps.instance?.mailer
    if (!mailer) {
      return { ok: false, to, message: 'SMTP is not configured (set SMTP_HOST and SMTP_FROM).' }
    }
    try {
      await mailer.send({
        to,
        subject: 'CirCI test mail',
        text: 'If you can read this, CirCI can send mail.\n',
      })
      return { ok: true, to, message: `Sent a test mail to ${to}.` }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { ok: false, to, message: `Could not send the test mail: ${reason}` }
    }
  })
}
