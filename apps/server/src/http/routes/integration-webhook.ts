import type { Database } from '@circi/db'
import { type IntegrationRegistry, integrationRegistry } from '@circi/integrations'
import { type ProviderRegistry } from '@circi/integrations/git'
import { claimWebhookDelivery, handleGitEvents } from '@circi/services'
import type { FastifyBaseLogger, FastifyPluginAsync, RouteHandlerMethod } from 'fastify'
import { z } from 'zod'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps as HttpDeps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

/**
 * What a git host tells CirCI, for every git host of the registry through ONE route:
 * `POST /api/integrations/:kind/webhook`, and `POST /webhooks/:kind` (the address the hosts were
 * first set up with, kept as an alias for the same handler). The
 * definition's `git` capability verifies the delivery (signature or token) and turns it into
 * normalised events; `handleGitEvents` in `@circi/services` is the one handler for all hosts.
 *
 * Deliveries are verified before anything is read, handled once per delivery id, and acted on only
 * for host accounts that a CirCI member of the team's workspace linked to their sign-in.
 */

export namespace integrationWebhookRoutes {
  export interface Deps {
    db: Database
    /** The instance secret: opens connections' credentials and derives webhook secrets. */
    authSecret: string
    publicOrigin: string
    /** Instance settings of the integrations (an App's own credentials) and a replaceable `fetch`. */
    integrations?: HttpDeps.IntegrationsOption | undefined
    /** Stands in for the git host adapters by connection kind (tests). */
    providers?: ProviderRegistry<object> | undefined
    webhookAllowPrivate?: boolean | undefined
    logger: FastifyBaseLogger
  }
}

const params = z.object({ kind: z.string() })

export const integrationWebhookRoutes: FastifyPluginAsync<integrationWebhookRoutes.Deps> = async (
  app,
  deps,
) => {
  // The signature covers the exact bytes, so keep them: parse JSON only after verifying.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })
  const registry: IntegrationRegistry = deps.integrations?.registry ?? integrationRegistry
  const ctx = integrationContext(deps)

  const receive: RouteHandlerMethod = async (req, reply) => {
    const { kind } = parse(params, req.params)
    const definition = registry.get(kind)
    const git = definition?.capabilities.git
    const provider = ctx ? git?.provider(ctx) : undefined
    if (!definition || !git || !ctx || !provider) {
      return reply.code(404).send({ error: 'No such git host' })
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!provider.verifyWebhook(raw, req.headers)) {
      return reply.code(401).send({ error: 'Bad signature' })
    }
    const delivery = git.webhook.deliveryId(req.headers, raw)
    if (!delivery) return reply.code(400).send({ error: 'Missing delivery id' })
    if (!(await claimWebhookDelivery(deps.db, delivery))) return { ok: true, duplicate: true }

    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'))
      payload = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
    } catch {
      return reply.code(400).send({ error: 'Not JSON' })
    }
    try {
      await handleGitEvents(deps.db, {
        definition,
        ctx,
        events: git.webhook.events(req.headers, payload),
        log: req.log,
      })
    } catch (err) {
      // Acknowledge anyway: the host would only redeliver the same thing.
      req.log.error({ err, kind, delivery }, 'git webhook handling failed')
    }
    return { ok: true }
  }

  app.post('/api/integrations/:kind/webhook', receive)
  app.post('/webhooks/:kind', receive)
}
