import type { Integration } from '@circi/api'
import { openSecret, sealSecret, signState, verifyState } from '@circi/core'
import {
  createIntegration,
  findIntegrationByExternalId,
  getIntegration,
  getMemberRole,
  getOrganizationBySlug,
  getProjectBySlugs,
  listOrgProjectMappings,
  removeIntegrationProject,
  replaceIntegrationCredentials,
  setIntegrationAttention,
  setIntegrationProject,
} from '@circi/db'
import {
  IntegrationError,
  type IntegrationDefinition,
  integrationRegistry,
  mappingExtraSchema,
  normalizeExtra,
  describeDefinition,
} from '@circi/integrations'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { integrationContext } from '#http/lib/integration-context.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const kindParams = z.object({ org: z.string(), kind: z.string() })
const idParams = z.object({ org: z.string(), id: z.uuid() })
const mappingParams = idParams.extend({ project: z.string() })
const callbackParams = z.object({ kind: z.string() })
const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})
const mappingBody = z.strictObject({
  ref: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(200).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

const callbackPath = (kind: string) => `/integrations/${kind}/callback`

/** A target as the dashboard gets it. */
function wireTarget(t: IntegrationDefinition.Target): Integration.Target {
  const out: Integration.Target = { id: t.id, name: t.name }
  if (t.label) out.label = t.label
  return out
}

/** Replies for an error thrown by a definition's connect or exchange; rethrows unknown ones. */
async function replyConnectError(req: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof IntegrationError) {
    if (err.status === 502) req.log.warn({ err }, 'could not connect the integration')
    return reply.code(err.status).send({ error: err.message })
  }
  throw err
}

/** The pieces the generic routes and the transitional tracker delegation share. */
function createGeneric(deps: Deps.Dashboard) {
  const registry = deps.integrations?.registry ?? integrationRegistry

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
      return undefined
    }
    return found
  }

  /** The registered definition for `:kind`, replying 404 for an unknown one. */
  async function definitionFor(kind: string, reply: FastifyReply) {
    const definition = registry.get(kind)
    if (!definition) {
      await reply.code(404).send({ error: 'Integration not found' })
      return undefined
    }
    return definition
  }

  /** The integration of the organisation named by `:id`, with its definition; replies 404 otherwise. */
  async function integrationFor(orgId: string, id: string, reply: FastifyReply) {
    const integration = await getIntegration(deps.db, orgId, id)
    const definition = integration ? registry.get(integration.kind) : undefined
    if (!integration || !definition) {
      await reply.code(404).send({ error: 'Integration not found' })
      return undefined
    }
    return { integration, definition }
  }

  /** The instance context, or a 400 when it cannot seal credentials. */
  async function contextFor(reply: FastifyReply) {
    const ctx = integrationContext(deps)
    if (!ctx) await reply.code(400).send({ error: 'This instance cannot store credentials' })
    return ctx
  }

  /** Stores a connected account sealed: a reconnect of the same account replaces its credentials. */
  async function store(
    orgId: string,
    userId: string,
    kind: string,
    connected: IntegrationDefinition.ConnectResult,
    ctx: IntegrationDefinition.Context,
    options: { replace: boolean },
  ): Promise<string> {
    const sealed = sealSecret(ctx.authSecret, connected.credentials)
    const existing = options.replace
      ? await findIntegrationByExternalId(deps.db, orgId, kind, connected.externalId)
      : undefined
    if (existing) {
      await replaceIntegrationCredentials(deps.db, existing.id, {
        displayName: connected.displayName,
        encryptedCredentials: sealed,
      })
      return existing.id
    }
    const created = await createIntegration(deps.db, {
      orgId,
      kind,
      displayName: connected.displayName,
      externalId: connected.externalId,
      encryptedCredentials: sealed,
      createdBy: userId,
    })
    return created.id
  }

  /** What the integration's account lets a project be pointed at (channels, teams…). */
  const targets = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.org.id, id, reply)
    if (!loaded) return reply
    const { integration, definition } = loaded
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    if (!definition.mapping?.listTargets) {
      return reply.code(404).send({ error: `${definition.name} has no targets to choose from` })
    }
    const credentials = integration.encryptedCredentials
      ? openSecret(ctx.authSecret, integration.encryptedCredentials)
      : undefined
    if (!credentials) {
      return reply
        .code(409)
        .send({ error: `The ${definition.name} credentials cannot be read; connect it again` })
    }
    try {
      const listed = await definition.mapping.listTargets(credentials, ctx)
      return { targets: listed.map(wireTarget) }
    } catch (err) {
      const reason = definition.needsAttention(err)
      if (reason) {
        await setIntegrationAttention(deps.db, integration.id, reason)
        return reply.code(409).send({
          error: `${definition.name} no longer accepts this connection; reconnect it`,
        })
      }
      req.log.warn({ err }, `could not list ${definition.name} targets`)
      return reply.code(502).send({ error: `${definition.name} did not answer; try again shortly` })
    }
  }

  /** Points a project at a target (replacing its earlier one) with the definition's settings. */
  const put = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.org.id, params.id, reply)
    if (!loaded) return reply
    const { integration, definition } = loaded
    const mapping = definition.mapping
    if (!mapping)
      return reply.code(404).send({ error: `${definition.name} has no project mapping` })
    const body = parse(mappingBody, req.body)
    const invalid = mapping.target.validate?.(body.ref)
    if (invalid) return reply.code(400).send({ error: invalid })
    if (mapping.target.kind === 'select' && !body.name) {
      return reply
        .code(400)
        .send({ error: `name: the ${mapping.target.label.toLowerCase()}'s name is required` })
    }
    const extra = normalizeExtra(mapping, parse(mappingExtraSchema(mapping), body.extra ?? {}))
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: params.project,
    })
    await setIntegrationProject(deps.db, {
      integrationId: integration.id,
      projectId: project.id,
      externalRef: body.ref,
      extra: { ...(body.name ? { name: body.name } : {}), ...extra },
    })
    return reply.code(204).send()
  }

  /** Stops a project using the integration. */
  const remove = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.org.id, params.id, reply)
    if (!loaded) return reply
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: params.project,
    })
    await removeIntegrationProject(deps.db, loaded.integration.id, project.id)
    return reply.code(204).send()
  }

  /**
   * Whether `:id` is an integration of the registry, without replying: the tracker routes share
   * these paths until Linear and Jira are migrated and ask first.
   */
  async function claims(req: FastifyRequest): Promise<boolean> {
    const params = idParams.safeParse(req.params)
    if (!params.success) return false
    const org = await getOrganizationBySlug(deps.db, params.data.org).catch(() => undefined)
    const integration = org ? await getIntegration(deps.db, org.id, params.data.id) : undefined
    return integration !== undefined && registry.has(integration.kind)
  }

  return {
    registry,
    loadForManager,
    definitionFor,
    integrationFor,
    contextFor,
    store,
    targets,
    put,
    remove,
    claims,
  }
}

/**
 * The three mapping handlers for registry integrations, for `issue-trackers.ts` to delegate to:
 * the Linear and Jira routes still own `GET .../:id/targets` and `PUT|DELETE .../:id/projects/:project`
 * (Fastify takes a path once), so they ask `claims` first. Deleted when trackers are migrated; the
 * three routes then move into `dashboardGenericIntegrationRoutes`.
 */
export function genericMappingHandlers(deps: Deps.Dashboard) {
  const { claims, targets, put, remove } = createGeneric(deps)
  return { claims, targets, put, remove }
}

/**
 * The generic integration routes: every integration of the registry (`@circi/integrations`) is
 * connected, installed and mapped to projects through these, with no route of its own. Everyone
 * in the organisation can look at an integration's mappings; owners and admins connect, choose
 * targets and change settings. The events themselves are delivered by the worker's
 * `integration-event` job.
 *
 *   POST   /orgs/:org/integrations/:kind/connect       connect with the definition's form
 *   GET    /orgs/:org/integrations/:kind/install       the provider's OAuth install address
 *   GET    /integrations/:kind/callback                where the provider sends the browser back
 *   GET    /orgs/:org/integrations/:id/targets         what a project can be pointed at (*)
 *   GET    /orgs/:org/integrations/:id/projects        the integration and every project's mapping
 *   PUT    /orgs/:org/integrations/:id/projects/:project   map a project (*)
 *   DELETE /orgs/:org/integrations/:id/projects/:project   stop (*)
 *
 * (*) registered by `issue-trackers.ts` for now, which hands registry integrations to
 * `genericMappingHandlers`; they move here when Linear and Jira are migrated.
 */
export const dashboardGenericIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const { registry, loadForManager, definitionFor, integrationFor, contextFor, store } =
    createGeneric(deps)

  /**
   * Connects an integration with the values of its connect form. The definition's `connect`
   * checks them against the provider before anything is stored; the credentials are sealed. An
   * account the organisation already connected is a 409.
   */
  app.post('/orgs/:org/integrations/:kind/connect', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { kind } = parse(kindParams, req.params)
    const definition = await definitionFor(kind, reply)
    if (!definition) return reply
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    if (!definition.connect) {
      return reply
        .code(400)
        .send({ error: `${definition.name} is connected by installing its app` })
    }
    if (definition.available && !definition.available(ctx)) {
      return reply.code(400).send({ error: `This instance has no ${definition.name} set up` })
    }
    const input = parse(definition.credentials, req.body ?? {})
    try {
      const connected = await definition.connect(input, ctx)
      const id = await store(found.org.id, found.user.id, kind, connected, ctx, { replace: false })
      return reply.code(201).send({ id })
    } catch (err) {
      return replyConnectError(req, reply, err)
    }
  })

  /** The address to send the browser to for installing the app; `state` binds org, user and kind. */
  app.get('/orgs/:org/integrations/:kind/install', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { kind } = parse(kindParams, req.params)
    const definition = await definitionFor(kind, reply)
    if (!definition) return reply
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    if (!definition.oauth) {
      return reply.code(400).send({ error: `${definition.name} has no install to start` })
    }
    if (!definition.oauth.available(ctx)) {
      return reply
        .code(400)
        .send({ error: `This instance has no ${definition.name} app configured` })
    }
    const state = signState(ctx.authSecret, {
      kind,
      orgId: found.org.id,
      orgSlug: found.org.slug,
      userId: found.user.id,
    })
    const payload: Integration.Install = {
      url: definition.oauth.authorizeUrl(ctx, {
        redirectUri: `${deps.publicOrigin}/api${callbackPath(kind)}`,
        state,
      }),
    }
    return payload
  })

  /**
   * Where the provider sends the browser back. The signed `state` must be one this instance issued
   * recently for this kind, to this very user, for an organisation they still manage; only then is
   * the code exchanged and the credentials stored (sealed). Installing again for the same account
   * replaces the credentials and clears "needs attention".
   */
  app.get('/integrations/:kind/callback', async (req, reply) => {
    const { kind } = parse(callbackParams, req.params)
    const query = parse(callbackQuery, req.query)
    const user = currentUser(req)
    const definition = registry.get(kind)
    const ctx = integrationContext(deps)
    const claims = ctx && query.state ? verifyState(ctx.authSecret, query.state) : undefined
    const orgId = claims?.orgId
    const orgSlug = claims?.orgSlug
    if (!definition?.oauth || !ctx || !claims || !orgId || !orgSlug || claims.kind !== kind) {
      return reply
        .code(400)
        .send({ error: 'This install link is invalid or has expired; start again' })
    }
    if (claims.userId !== user.id) {
      return reply.code(400).send({ error: 'This install link was started by someone else' })
    }
    const role = await getMemberRole(deps.db, { userId: user.id, organizationId: orgId })
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
    }
    const list = `/organizations/${encodeURIComponent(orgSlug)}/settings/integrations`
    const failed = (result: 'denied' | 'failed') =>
      reply.redirect(`${list}?connect=${result}&kind=${encodeURIComponent(kind)}`)
    if (query.error || !query.code) return failed('denied')
    try {
      const connected = await definition.oauth.exchange(ctx, {
        code: query.code,
        redirectUri: `${deps.publicOrigin}/api${callbackPath(kind)}`,
      })
      const id = await store(orgId, user.id, kind, connected, ctx, { replace: true })
      return reply.redirect(`${list}/${encodeURIComponent(kind)}/${id}?connect=connected`)
    } catch (err) {
      req.log.warn({ err }, `could not finish the ${definition.name} install`)
      return failed('failed')
    }
  })

  /** The integration, its definition's public spec, and how each project of the organisation maps to it. */
  app.get('/orgs/:org/integrations/:id/projects', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.org.id, id, reply)
    if (!loaded) return reply
    const { integration, definition } = loaded
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    const ctx = integrationContext(deps)
    const payload: Integration.MappingPage = {
      canManage: role === 'owner' || role === 'admin',
      configured: ctx !== undefined && (definition.oauth?.available(ctx) ?? false),
      integration: {
        id: integration.id,
        kind: integration.kind,
        name: integration.displayName,
        needsAttention: integration.needsAttention,
        attentionReason: integration.needsAttentionReason,
      },
      definition: describeDefinition(
        definition,
        ctx ?? { authSecret: '', publicOrigin: deps.publicOrigin, config: {} },
      ),
      projects: (await listOrgProjectMappings(deps.db, found.org.id, integration.id)).map((p) => ({
        slug: p.slug,
        name: p.name,
        mapping: p.mapping
          ? {
              ref: p.mapping.externalRef,
              name: typeof p.mapping.extra.name === 'string' ? p.mapping.extra.name : null,
              extra: p.mapping.extra,
            }
          : null,
      })),
    }
    return payload
  })
}
