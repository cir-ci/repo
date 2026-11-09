import type { Integration } from '@circi/api'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  openSecret,
  signState,
  ValidationError,
  verifyState,
  canManage,
} from '@circi/core'
import {
  getIntegration,
  getMemberRole,
  getTeamBySlugs,
  listWorkspaceTeamMappings,
  listTeamLinks,
  type IntegrationLink,
} from '@circi/db'
import {
  IntegrationError,
  IntegrationUnreachableError,
  type IntegrationDefinition,
  integrationRegistry,
  mappingExtraSchema,
  normalizeExtra,
  describeDefinition,
} from '@circi/integrations'
import {
  addTeamLink,
  autoLinkTeam,
  connectIntegration,
  flagFailedIntegration,
  mapTeam,
  removeTeamLink,
  unmapTeam,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { INSTALL_FLOW } from '#composition/install-state.ts'
import { integrationContext } from '#composition/integration-context.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const kindParams = z.object({ workspace: z.string(), kind: z.string() })
const idParams = z.object({ workspace: z.string(), id: z.uuid() })
const mappingParams = idParams.extend({ team: z.string() })
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

const setupQuery = z.object({
  installation_id: z.string().optional(),
  setup_action: z.string().optional(),
  state: z.string().optional(),
})

const callbackPath = (kind: string) => `/integrations/${kind}/callback`

/** A target as the dashboard gets it. */
function wireTarget(t: IntegrationDefinition.Target): Integration.Target {
  const out: Integration.Target = { id: t.id, name: t.name }
  if (t.label) out.label = t.label
  return out
}

/** The repositories a git host's connection can see, as targets. */
async function listRepositories(
  git: NonNullable<IntegrationDefinition['capabilities']['git']>,
  externalId: string,
  credentials: string,
  ctx: IntegrationDefinition.Context,
): Promise<IntegrationDefinition.Target[]> {
  const provider = git.provider(ctx)
  if (!provider) return []
  const repositories = await provider.listRepositories(externalId, credentials || undefined)
  return repositories.map((r) => ({ id: r.ref, name: r.ref }))
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

/**
 * The integration's opened credentials; a conflict (409) when they cannot be read. A `secretless`
 * definition (an App-based git host) keeps none: its capabilities get an empty string.
 */
function credentialsFor(
  loaded: {
    integration: { encryptedCredentials: string | null }
    definition: IntegrationDefinition
  },
  ctx: IntegrationDefinition.Context,
) {
  if (loaded.definition.secretless) return ''
  const credentials = loaded.integration.encryptedCredentials
    ? openSecret(ctx.authSecret, loaded.integration.encryptedCredentials)
    : undefined
  if (credentials === undefined) {
    throw new ConflictError(
      `The ${loaded.definition.name} credentials cannot be read; connect it again`,
    )
  }
  return credentials
}

/**
 * The address a git host calls, and the secret to put on it (owners and admins only; a host whose
 * secret is configured elsewhere has none to show). Null for an integration with no webhook.
 */
function webhookOf(
  definition: IntegrationDefinition,
  ctx: IntegrationDefinition.Context | undefined,
  publicOrigin: string,
  role: string | undefined,
): Integration.MappingPage['webhook'] {
  const git = definition.capabilities.git
  if (!git) return null
  const canSee = canManage(role)
  return {
    url: `${publicOrigin}/webhooks/${definition.id}`,
    secret: canSee && ctx ? (git.webhook.secret?.(ctx) ?? null) : null,
  }
}

/** The pieces the generic routes share. */
function createGeneric(deps: Deps.Dashboard) {
  const registry = deps.integrations?.registry ?? integrationRegistry

  const loadForManager = (req: FastifyRequest) =>
    loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can manage integrations',
    })

  /** The registered definition for `:kind`; not found (404) for an unknown one. */
  function definitionFor(kind: string) {
    const definition = registry.get(kind)
    if (!definition) throw new NotFoundError('Integration not found')
    return definition
  }

  /** The integration of the workspace named by `:id`, with its definition; not found (404) otherwise. */
  async function integrationFor(workspaceId: string, id: string) {
    const integration = await getIntegration(deps.db, workspaceId, id)
    const definition = integration ? registry.get(integration.kind) : undefined
    if (!integration || !definition) throw new NotFoundError('Integration not found')
    return { integration, definition }
  }

  /** The instance context; a validation error (400) when it cannot seal credentials. */
  function contextFor() {
    const ctx = integrationContext(deps)
    if (!ctx) throw new ValidationError('This instance cannot store credentials')
    return ctx
  }

  /** Stores a connected account (see `connectIntegration`); returns the integration's id. */
  const store = (
    workspaceId: string,
    userId: string,
    definition: IntegrationDefinition,
    connected: IntegrationDefinition.ConnectResult,
    ctx: IntegrationDefinition.Context,
    options: { replace: boolean },
  ) =>
    connectIntegration(deps.db, {
      workspaceId,
      userId,
      definition,
      connected,
      ctx,
      replace: options.replace,
    })

  /**
   * Throws for a failed call to the provider: the definition's own errors keep their status, an
   * error it recognises as "a person has to act" flags the integration (409), anything else is a 502.
   */
  async function providerFailed(
    req: FastifyRequest,
    loaded: { integration: { id: string }; definition: IntegrationDefinition },
    err: unknown,
  ): Promise<never> {
    const { integration, definition } = loaded
    if (err instanceof IntegrationError) throw err // the error handler maps it by its code
    const flagged = await flagFailedIntegration(deps.db, {
      integrationId: integration.id,
      definition,
      error: err,
    })
    if (flagged) {
      throw new ConflictError(`${definition.name} no longer accepts this connection; reconnect it`)
    }
    req.log.warn({ err }, `the ${definition.name} call failed`)
    throw new IntegrationUnreachableError(`${definition.name} did not answer; try again shortly`)
  }

  /** What the integration's account lets a team be pointed at (channels, teams…). */
  const targets = async (req: FastifyRequest) => {
    const found = await loadForManager(req)
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.workspace.id, id)
    const { definition } = loaded
    const ctx = contextFor()
    const git = definition.capabilities.git
    const isRepository = definition.mapping?.target.kind === 'repository'
    if (!definition.mapping?.listTargets && !(git && isRepository)) {
      throw new NotFoundError(`${definition.name} has no targets to choose from`)
    }
    const credentials = credentialsFor(loaded, ctx)
    try {
      const listed =
        git && isRepository
          ? await listRepositories(git, loaded.integration.externalId, credentials, ctx)
          : ((await definition.mapping?.listTargets?.(credentials, ctx)) ?? [])
      return { targets: listed.map(wireTarget) }
    } catch (err) {
      return providerFailed(req, loaded, err)
    }
  }

  /** Points a team at a target (replacing its earlier one) with the definition's settings. */
  const put = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    const { integration, definition } = loaded
    const mapping = definition.mapping
    if (!mapping) throw new NotFoundError(`${definition.name} has no team mapping`)
    const body = parse(mappingBody, req.body)
    const invalid = mapping.target.validate?.(body.ref)
    if (invalid) throw new ValidationError(invalid)
    if (mapping.target.kind === 'select' && !body.name) {
      throw new ValidationError(
        `name: the ${mapping.target.label.toLowerCase()}'s name is required`,
      )
    }
    const extra = normalizeExtra(mapping, parse(mappingExtraSchema(mapping), body.extra ?? {}))
    const team = await getTeamBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: params.team,
    })
    let target: { ref: string; name?: string | undefined } = {
      ref: body.ref,
      name: body.name ?? (mapping.target.kind === 'repository' ? body.ref : undefined),
    }
    if (mapping.target.resolve) {
      // The definition checks the typed value with the provider and says what to store.
      const ctx = contextFor()
      const credentials = credentialsFor(loaded, ctx)
      try {
        target = await mapping.target.resolve(body.ref, { credentials }, ctx)
      } catch (err) {
        return providerFailed(req, loaded, err)
      }
    }
    await mapTeam(deps.db, {
      definition,
      integrationId: integration.id,
      teamId: team.id,
      ref: target.ref,
      extra: { ...(target.name ? { name: target.name } : {}), ...extra },
    })
    return reply.code(204).send()
  }

  /** Stops a team using the integration. */
  const remove = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    const team = await getTeamBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: params.team,
    })
    await unmapTeam(deps.db, {
      definition: loaded.definition,
      integrationId: loaded.integration.id,
      teamId: team.id,
    })
    return reply.code(204).send()
  }

  /** The integration `:id` and the team `:team` of the workspace, with the definition's links section; throws otherwise. */
  async function linksFor(req: FastifyRequest, options: { manage: boolean }) {
    const found = options.manage ? await loadForManager(req) : await loadWorkspace(deps, req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    if (!loaded.definition.links) throw new NotFoundError(`${loaded.definition.name} has no links`)
    const team = await getTeamBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: params.team,
    })
    return { ...loaded, links: loaded.definition.links, team, user: found.user }
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
 * connected, installed and mapped to teams through these, with no route of its own. Everyone
 * in the workspace can look at an integration's mappings; owners and admins connect, choose
 * targets and change settings. The events themselves are delivered by the worker's
 * `integration-event` job.
 *
 *   POST   /workspaces/:workspace/integrations/:kind/connect       connect with the definition's form
 *   GET    /workspaces/:workspace/integrations/:kind/install       the provider's OAuth install address
 *   GET    /integrations/:kind/callback                where the provider sends the browser back
 *   GET    /workspaces/:workspace/integrations/:id/targets         what a team can be pointed at
 *   GET    /workspaces/:workspace/integrations/:id/teams        the integration and every team's mapping
 *   PUT    /workspaces/:workspace/integrations/:id/teams/:team   map a team
 *   DELETE /workspaces/:workspace/integrations/:id/teams/:team   stop
 *   GET    /workspaces/:workspace/integrations/:id/teams/:team/links          the team's links
 *   POST   /workspaces/:workspace/integrations/:id/teams/:team/links          add one
 *   DELETE /workspaces/:workspace/integrations/:id/teams/:team/links/:linkId  remove one
 *   POST   /workspaces/:workspace/integrations/:id/teams/:team/links/auto     link by name
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

  app.get('/workspaces/:workspace/integrations/:id/targets', targets)
  app.put('/workspaces/:workspace/integrations/:id/teams/:team', put)
  app.delete('/workspaces/:workspace/integrations/:id/teams/:team', remove)

  /** A team's links (Figma frames), for every member. */
  app.get('/workspaces/:workspace/integrations/:id/teams/:team/links', async (req) => {
    const found = await linksFor(req, { manage: false })
    const payload: Integration.LinkList = {
      links: (await listTeamLinks(deps.db, found.team.id, found.links.kind))
        .filter((l) => l.integrationId === found.integration.id)
        .map(wireLink),
    }
    return payload
  })

  /** Adds a link from the values of the definition's link fields; the definition checks them with the provider. */
  app.post('/workspaces/:workspace/integrations/:id/teams/:team/links', async (req, reply) => {
    const found = await linksFor(req, { manage: true })
    const ctx = contextFor()
    const { values } = parse(linkBody, req.body)
    try {
      const link = await addTeamLink(deps.db, {
        definition: found.definition,
        ctx,
        integration: found.integration,
        teamId: found.team.id,
        values,
        createdBy: found.user.id,
      })
      return reply.code(201).send(wireLink(link))
    } catch (err) {
      if (err instanceof ValidationError) throw err
      return providerFailed(req, found, err)
    }
  })

  app.delete(
    '/workspaces/:workspace/integrations/:id/teams/:team/links/:linkId',
    async (req, reply) => {
      const found = await linksFor(req, { manage: true })
      const { linkId } = parse(linkParams, req.params)
      if (!z.uuid().safeParse(linkId).success) throw new NotFoundError('Link not found')
      await removeTeamLink(deps.db, {
        integrationId: found.integration.id,
        teamId: found.team.id,
        linkId,
      })
      return reply.code(204).send()
    },
  )

  /** Links the team's snapshots to what the mapped target offers, by name; existing links are left alone. */
  app.post('/workspaces/:workspace/integrations/:id/teams/:team/links/auto', async (req) => {
    const found = await linksFor(req, { manage: true })
    const ctx = contextFor()
    try {
      const result: Integration.AutoLinkResult = await autoLinkTeam(deps.db, {
        definition: found.definition,
        ctx,
        integration: found.integration,
        teamId: found.team.id,
        createdBy: found.user.id,
      })
      return result
    } catch (err) {
      if (err instanceof ValidationError) throw err
      return providerFailed(req, found, err)
    }
  })

  /**
   * Connects an integration with the values of its connect form. The definition's `connect`
   * checks them against the provider before anything is stored; the credentials are sealed. An
   * account the workspace already connected is a 409.
   */
  app.post('/workspaces/:workspace/integrations/:kind/connect', async (req, reply) => {
    const found = await loadForManager(req)
    const { kind } = parse(kindParams, req.params)
    const definition = definitionFor(kind)
    const ctx = contextFor()
    if (!definition.connect) {
      throw new ValidationError(`${definition.name} is connected by installing its app`)
    }
    if (definition.available && !definition.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} set up`)
    }
    const input = parse(definition.credentials, req.body ?? {})
    // An IntegrationError it throws is answered by the error handler (400, 409, 502…).
    const connected = await definition.connect(input, ctx)
    const id = await store(found.workspace.id, found.user.id, definition, connected, ctx, {
      replace: false,
    })
    return reply.code(201).send({ id })
  })

  /** The address to send the browser to for installing the app; `state` binds workspace, user and kind. */
  app.get('/workspaces/:workspace/integrations/:kind/install', async (req) => {
    const found = await loadForManager(req)
    const { kind } = parse(kindParams, req.params)
    const definition = definitionFor(kind)
    const ctx = contextFor()
    if (!definition.oauth) {
      throw new ValidationError(`${definition.name} has no install to start`)
    }
    if (!definition.oauth.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} app configured`)
    }
    const state = signState(ctx.authSecret, {
      kind,
      workspaceId: found.workspace.id,
      workspaceSlug: found.workspace.slug,
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
   * recently for this kind, to this very user, for a workspace they still manage; only then is
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
    const workspaceId = claims?.workspaceId
    const workspaceSlug = claims?.workspaceSlug
    if (
      !definition?.oauth ||
      !ctx ||
      !claims ||
      !workspaceId ||
      !workspaceSlug ||
      claims.kind !== kind
    ) {
      throw new ValidationError('This install link is invalid or has expired; start again')
    }
    if (claims.userId !== user.id) {
      throw new ValidationError('This install link was started by someone else')
    }
    const role = await getMemberRole(deps.db, { userId: user.id, workspaceId: workspaceId })
    if (!canManage(role)) {
      throw new ForbiddenError('Only owners and admins can manage integrations')
    }
    const list = `/workspaces/${encodeURIComponent(workspaceSlug)}/settings/integrations`
    const failed = (result: 'denied' | 'failed') =>
      reply.redirect(`${list}?connect=${result}&kind=${encodeURIComponent(kind)}`)
    if (query.error || !query.code) return failed('denied')
    try {
      const connected = await definition.oauth.exchange(ctx, {
        code: query.code,
        redirectUri: `${deps.publicOrigin}/api${callbackPath(kind)}`,
      })
      const id = await store(workspaceId, user.id, definition, connected, ctx, { replace: true })
      return reply.redirect(`${list}/${encodeURIComponent(kind)}/${id}?connect=connected`)
    } catch (err) {
      req.log.warn({ err }, `could not finish the ${definition.name} install`)
      return failed('failed')
    }
  })

  /**
   * Where a provider sends the browser after its app is installed (`setup_url`; also when it is
   * installed from the provider's own site). With a `state` this instance issued (the install
   * started in a workspace's Add dialog) the installation is connected to that workspace by the
   * same `connect` and `store` as the manual form: the provider must really have the app
   * installed, an `exclusive` account may be used by no other workspace (409), and the signed-in
   * user must still own or administer the workspace. Without a `state` the person picks the
   * workspace on a dashboard page that connects through the same endpoint.
   */
  app.get('/integrations/:kind/setup', async (req, reply) => {
    const { kind } = parse(callbackParams, req.params)
    const query = parse(setupQuery, req.query)
    const user = currentUser(req)
    const definition = registry.get(kind)
    const ctx = integrationContext(deps)
    if (!definition?.connect || !definition.setup || !ctx) {
      throw new NotFoundError('Integration not found')
    }
    const claims = query.state ? verifyState(ctx.authSecret, query.state) : undefined
    if (query.state && (claims?.kind !== kind || claims.flow !== INSTALL_FLOW)) {
      throw new ValidationError('This install link is invalid or has expired; start again')
    }
    if (claims && claims.userId !== user.id) {
      throw new ValidationError('This install link was started by someone else')
    }
    const workspaceId = claims?.workspaceId
    const workspaceSlug = claims?.workspaceSlug
    const list = workspaceSlug
      ? `/workspaces/${encodeURIComponent(workspaceSlug)}/settings/integrations`
      : '/'
    const values = definition.setup(Object.fromEntries(Object.entries(query)))
    if (!values) {
      // A request to install, or an update that changed nothing: nothing to connect.
      return reply.redirect(
        workspaceSlug ? `${list}?connect=denied&kind=${encodeURIComponent(kind)}` : '/',
      )
    }
    if (!workspaceId || !workspaceSlug) {
      const rest = new URLSearchParams(Object.entries(query).filter(([k]) => k !== 'state'))
      return reply.redirect(`/integrations/${encodeURIComponent(kind)}/setup?${rest.toString()}`)
    }
    const role = await getMemberRole(deps.db, { userId: user.id, workspaceId: workspaceId })
    if (!canManage(role)) {
      throw new ForbiddenError('Only owners and admins can manage integrations')
    }
    if (definition.available && !definition.available(ctx)) {
      throw new ValidationError(`This instance has no ${definition.name} set up`)
    }
    const connected = await definition.connect(parse(definition.credentials, values), ctx)
    const id = await store(workspaceId, user.id, definition, connected, ctx, { replace: false })
    return reply.redirect(`${list}/${encodeURIComponent(kind)}/${id}?connect=connected`)
  })

  /** The integration, its definition's public spec, and how each team of the workspace maps to it. */
  app.get('/workspaces/:workspace/integrations/:id/teams', async (req) => {
    const found = await loadWorkspace(deps, req)
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.workspace.id, id)
    const { integration, definition } = loaded
    const { role } = found
    const ctx = integrationContext(deps)
    const payload: Integration.MappingPage = {
      canManage: found.canManage,
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
      webhook: webhookOf(definition, ctx, deps.publicOrigin, role),
      teams: (await listWorkspaceTeamMappings(deps.db, found.workspace.id, integration.id)).map(
        (p) => ({
          slug: p.slug,
          name: p.name,
          mapping: p.mapping
            ? {
                ref: p.mapping.externalRef,
                name: typeof p.mapping.extra.name === 'string' ? p.mapping.extra.name : null,
                extra: p.mapping.extra,
              }
            : null,
        }),
      ),
    }
    return payload
  })
}
