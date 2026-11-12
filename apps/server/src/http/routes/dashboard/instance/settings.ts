import type { InstanceAdmin } from '@circi/api'
import type { FastifyPluginAsync } from 'fastify'

import { describeSettings } from '#composition/instance-settings.ts'
import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'

/** `/api/instance/settings` (what the page shows, from the settings service) and `/api/instance/mail/test`. */
export const dashboardInstanceSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin())

  app.get('/instance/settings', async (_req, reply) => {
    if (!deps.instance || !deps.instanceConfig) {
      return reply.code(501).send({ error: "Instance settings aren't available" })
    }
    const settings: InstanceAdmin.Settings = describeSettings(
      deps.instance,
      deps,
      await deps.instanceConfig.describe(),
    )
    return settings
  })

  /** Sends a test mail to the signed-in admin's own address; the outcome is in the body. */
  app.post('/instance/mail/test', async (req): Promise<InstanceAdmin.MailTest> => {
    const to = currentUser(req).email
    const mailer = deps.instance?.mailer
    if (!mailer || (await mailer.configured?.()) === false) {
      return { ok: false, to, message: "Mail isn't set up. Add a mail server first." }
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
      return { ok: false, to, message: `Couldn't send the test mail: ${reason}` }
    }
  })
}
