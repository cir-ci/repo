import type { Integration } from '@circi/api'
import { openSecret, sealSecret, signState, ValidationError, verifyState } from '@circi/core'
import {
  createIntegration,
  deleteIntegrationLink,
  findIntegrationByExternalId,
  getIntegration,
  getMemberRole,
  getProjectBySlugs,
  listOrgProjectMappings,
  listProjectLinks,
  replaceIntegrationCredentials,
  setIntegrationAttention,
  type IntegrationLink,
} from '@circi/db'
import {
  IntegrationError,
  type IntegrationDefinition,
  integrationRegistry,
  mappingExtraSchema,
  normalizeExtra,
  describeDefinition,
} from '@circi/integrations'
import { addProjectLink, autoLinkProject, mapProject, unmapProject } from '@circi/services'
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
const linkParams = mappingParams.extend({ linkId: z.string() })
const linkBody = z.strictObject({ values: z.record(z.string(), z.string()) })
const mappingBody = z.strictObject({
  ref: z.string().trim().min(1).max(1000),
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

/** A link as the dashboard gets it. */
const wireLink = (l: IntegrationLink.Row): Integration.Link => ({
  id: l.id,
  subject: l.subject ?? '',
  ref: l.externalRef,
  url: l.url,
  title: l.title,
  source: l.payload.source === 'auto' ? 'auto' : 'manual',
  createdAt: l.createdAt.toISOString(),
})

/** The integration's opened credentials, replying 409 when they cannot be read. */
async function credentialsFor(
  reply: FastifyReply,
  loaded: {
    integration: { encryptedCredentials: string | null }
    definition: IntegrationDefinition
  },
  ctx: IntegrationDefinition.Context,
) {
  const credentials = loaded.integration.encryptedCredentials
    ? openSecret(ctx.authSecret, loaded.integration.encryptedCredentials)
    : undefined
  if (!credentials) {
    await reply.code(409).send({
      error: `The ${loaded.definition.name} credentials cannot be read; connect it again`,
    })
  }
  return credentials
}

/** The pieces the generic routes share. */
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

  /**
   * Replies for a failed call to the provider: the definition's own errors keep their status, an
   * error it recognises as "a person has to act" flags the integration (409), anything else is a 502.
   */
  async function providerFailed(
    req: FastifyRequest,
    reply: FastifyReply,
    loaded: { integration: { id: string }; definition: IntegrationDefinition },
    err: unknown,
  ) {
    const { integration, definition } = loaded
    if (err instanceof IntegrationError) return reply.code(err.status).send({ error: err.message })
    const reason = definition.needsAttention(err)
    if (reason) {
      await setIntegrationAttention(deps.db, integration.id, reason)
      return reply.code(409).send({
        error: `${definition.name} no longer accepts this connection; reconnect it`,
      })
    }
    req.log.warn({ err }, `the ${definition.name} call failed`)
    return reply.code(502).send({ error: `${definition.name} did not answer; try again shortly` })
  }

  /** What the integration's account lets a project be pointed at (channels, teams…). */
  const targets = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.org.id, id, reply)
    if (!loaded) return reply
    const { definition } = loaded
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    if (!definition.mapping?.listTargets) {
      return reply.code(404).send({ error: `${definition.name} has no targets to choose from` })
    }
    const credentials = await credentialsFor(reply, loaded, ctx)
    if (!credentials) return reply
    try {
      const listed = await definition.mapping.listTargets(credentials, ctx)
      return { targets: listed.map(wireTarget) }
    } catch (err) {
      return providerFailed(req, reply, loaded, err)
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
    let target: { ref: string; name?: string | undefined } = { ref: body.ref, name: body.name }
    if (mapping.target.resolve) {
      // The definition checks the typed value with the provider and says what to store.
      const ctx = await contextFor(reply)
      if (!ctx) return reply
      const credentials = await credentialsFor(reply, loaded, ctx)
      if (!credentials) return reply
      try {
        target = await mapping.target.resolve(body.ref, { credentials }, ctx)
      } catch (err) {
        return providerFailed(req, reply, loaded, err)
      }
    }
    await mapProject(deps.db, {
      definition,
      integrationId: integration.id,
      projectId: project.id,
      ref: target.ref,
      extra: { ...(target.name ? { name: target.name } : {}), ...extra },
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
    await unmapProject(deps.db, {
      definition: loaded.definition,
      integrationId: loaded.integration.id,
      projectId: project.id,
    })
    return reply.code(204).send()
  }

  /** The integration `:id` and the project `:project` of the organisation, with the definition's links section; replies otherwise. */
  async function linksFor(req: FastifyRequest, reply: FastifyReply, options: { manage: boolean }) {
    const found = options.manage
      ? await loadForManager(req, reply)
      : await loadOrg(deps, req, reply)
    if (!found) return undefined
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.org.id, params.id, reply)
    if (!loaded) return undefined
    if (!loaded.definition.links) {
      await reply.code(404).send({ error: `${loaded.definition.name} has no links` })
      return undefined
    }
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: params.project,
    })
    return { ...loaded, links: loaded.definition.links, project, user: found.user }
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
    providerFailed,
    linksFor,
  }
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
 *   GET    /orgs/:org/integrations/:id/targets         what a project can be pointed at
 *   GET    /orgs/:org/integrations/:id/projects        the integration and every project's mapping
 *   PUT    /orgs/:org/integrations/:id/projects/:project   map a project
 *   DELETE /orgs/:org/integrations/:id/projects/:project   stop
 *   GET    /orgs/:org/integrations/:id/projects/:project/links          the project's links
 *   POST   /orgs/:org/integrations/:id/projects/:project/links          add one
 *   DELETE /orgs/:org/integrations/:id/projects/:project/links/:linkId  remove one
 *   POST   /orgs/:org/integrations/:id/projects/:project/links/auto     link by name
 */
export const dashboardGenericIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const {
    registry,
    loadForManager,
    definitionFor,
    integrationFor,
    contextFor,
    store,
    targets,
    put,
    remove,
    providerFailed,
    linksFor,
  } = createGeneric(deps)

  app.get('/orgs/:org/integrations/:id/targets', targets)
  app.put('/orgs/:org/integrations/:id/projects/:project', put)
  app.delete('/orgs/:org/integrations/:id/projects/:project', remove)

  /** A project's links (Figma frames), for every member. */
  app.get('/orgs/:org/integrations/:id/projects/:project/links', async (req, reply) => {
    const found = await linksFor(req, reply, { manage: false })
    if (!found) return reply
    const payload: Integration.LinkList = {
      links: (await listProjectLinks(deps.db, found.project.id, found.links.kind))
        .filter((l) => l.integrationId === found.integration.id)
        .map(wireLink),
    }
    return payload
  })

  /** Adds a link from the values of the definition's link fields; the definition checks them with the provider. */
  app.post('/orgs/:org/integrations/:id/projects/:project/links', async (req, reply) => {
    const found = await linksFor(req, reply, { manage: true })
    if (!found) return reply
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    const { values } = parse(linkBody, req.body)
    try {
      const link = await addProjectLink(deps.db, {
        definition: found.definition,
        ctx,
        integration: found.integration,
        projectId: found.project.id,
        values,
        createdBy: found.user.id,
      })
      return reply.code(201).send(wireLink(link))
    } catch (err) {
      if (err instanceof ValidationError) throw err
      return providerFailed(req, reply, found, err)
    }
  })

  app.delete('/orgs/:org/integrations/:id/projects/:project/links/:linkId', async (req, reply) => {
    const found = await linksFor(req, reply, { manage: true })
    if (!found) return reply
    const { linkId } = parse(linkParams, req.params)
    if (
      !z.uuid().safeParse(linkId).success ||
      !(await deleteIntegrationLink(deps.db, found.integration.id, linkId, found.project.id))
    ) {
      return reply.code(404).send({ error: 'Link not found' })
    }
    return reply.code(204).send()
  })

  /** Links the project's snapshots to what the mapped target offers, by name; existing links are left alone. */
  app.post('/orgs/:org/integrations/:id/projects/:project/links/auto', async (req, reply) => {
    const found = await linksFor(req, reply, { manage: true })
    if (!found) return reply
    const ctx = await contextFor(reply)
    if (!ctx) return reply
    try {
      const result: Integration.AutoLinkResult = await autoLinkProject(deps.db, {
        definition: found.definition,
        ctx,
        integration: found.integration,
        projectId: found.project.id,
        createdBy: found.user.id,
      })
      return result
    } catch (err) {
      if (err instanceof ValidationError) throw err
      return providerFailed(req, reply, found, err)
    }
  })

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
