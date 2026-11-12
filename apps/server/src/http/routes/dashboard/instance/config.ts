import type { InstanceAdmin } from '@circi/api'
import { INSTANCE_LIMIT_KEYS, type SignInMethodKind, WORKSPACE_CREATIONS } from '@circi/core'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const limitFields = Object.fromEntries(INSTANCE_LIMIT_KEYS.map((key) => [key, z.number()]))
const limitsBody = z.strictObject(limitFields).partial()
const creationBody = z.strictObject({ value: z.enum(WORKSPACE_CREATIONS) })
const signInBody = z
  .strictObject({ password: z.boolean(), email: z.boolean(), sso: z.boolean() })
  .partial()
const smtpBody = z.strictObject({
  host: z.string().max(255),
  port: z.number(),
  secure: z.boolean(),
  user: z.string().max(255),
  from: z.string().max(255),
  password: z.string().max(1000).nullable().optional(),
})
const slackBody = z.strictObject({
  clientId: z.string().max(255),
  clientSecret: z.string().max(1000).optional(),
})
const ssoBody = z.strictObject({
  name: z.string().max(100).optional(),
  clientId: z.string().max(255),
  clientSecret: z.string().max(2000).optional(),
  issuer: z.string().max(500).optional(),
  trustedForEmail: z.boolean(),
})
const ssoParams = z.object({ id: z.enum(['github', 'gitlab', 'google', 'oidc']) })

/** The kind of sign-in the admin making the change used, so a save can't lock them out. */
function signInKind(method: unknown): SignInMethodKind | undefined {
  if (method === 'password') return 'password'
  if (method === 'email') return 'email'
  if (
    method === 'oidc' ||
    (typeof method === 'object' && method !== null && 'oidcProvider' in method)
  ) {
    return 'sso'
  }
  return undefined
}

const actorOf = (method: unknown) => {
  const using = signInKind(method)
  return using ? { using } : {}
}

/** The service's description is the wire type (checked here at compile time). */
const wire = (config: InstanceAdmin.Config): InstanceAdmin.Config => config

/**
 * `/api/instance/config/…`: the instance settings an admin can change in the dashboard. Each group
 * answers with the whole described configuration (sources, locks, no secret). A setting whose
 * environment variable is set is refused (409); a change that would leave nobody able to sign in
 * is refused with the reason (409); invalid values are 400 with the field.
 */
export const dashboardInstanceConfigRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin())
  const store = deps.instanceConfig
  if (!store) return

  app.put('/instance/config/workspace-creation', async (req) =>
    wire(await store.setWorkspaceCreation(parse(creationBody, req.body).value)),
  )

  app.put('/instance/config/sign-in', async (req) =>
    wire(await store.setSignIn(parse(signInBody, req.body), actorOf(currentUser(req).method))),
  )

  app.put('/instance/config/limits', async (req) =>
    wire(await store.setLimits(parse(limitsBody, req.body))),
  )

  app.put('/instance/config/smtp', async (req) =>
    wire(await store.saveSmtp(parse(smtpBody, req.body), actorOf(currentUser(req).method))),
  )
  app.delete('/instance/config/smtp', async (req) =>
    wire(await store.removeSmtp(actorOf(currentUser(req).method))),
  )

  app.put('/instance/config/slack', async (req) =>
    wire(await store.saveSlack(parse(slackBody, req.body))),
  )
  app.delete('/instance/config/slack', async () => wire(await store.removeSlack()))

  app.put('/instance/config/sso/:id', async (req) => {
    const { id } = parse(ssoParams, req.params)
    return wire(
      await store.saveSso({ id, ...parse(ssoBody, req.body) }, actorOf(currentUser(req).method)),
    )
  })
  app.delete('/instance/config/sso/:id', async (req) => {
    const { id } = parse(ssoParams, req.params)
    return wire(await store.removeSso(id, actorOf(currentUser(req).method)))
  })
}
