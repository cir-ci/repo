import type { Issue } from '@circi/api'
import { openSecret, sealSecret } from '@circi/core'
import {
  createIntegration,
  getBuildByNumber,
  getIntegration,
  getMemberRole,
  getOrganizationBySlug,
  getProjectBySlugs,
  listBuildIssueLinks,
  listIntegrationProjects,
  listIntegrations,
  listProjects,
  listProjectTrackers,
  removeIntegrationProject,
  setIntegrationAttention,
  setIntegrationProject,
  TRACKER_KINDS,
  type OrgIntegration,
} from '@circi/db'
import {
  createTrackerFactory,
  type IssueTracker,
  isConnectionRevoked,
  ProviderApiError,
  serializeCredentials,
} from '@circi/providers'
import { createIssueFromBuild, MAX_ISSUE_TITLE_LENGTH } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

import { genericMappingHandlers } from './integrations-generic.ts'

const orgParams = z.object({ org: z.string() })
const mappingParams = orgParams.extend({ id: z.uuid(), project: z.string() })
const buildParams = z.object({ org: z.string(), project: z.string(), number: z.string() })

const linearBody = z.strictObject({ apiKey: z.string().trim().min(1).max(500) })
const jiraBody = z.strictObject({
  siteUrl: z.string().trim().min(1).max(300),
  email: z.string().trim().min(1).max(320),
  apiToken: z.string().trim().min(1).max(1000),
})
const targetBody = z.strictObject({ target: z.string().min(1).max(200) })
const createBody = z.strictObject({
  integrationId: z.uuid(),
  snapshotName: z.string().min(1).max(500).optional(),
  title: z
    .string()
    .max(MAX_ISSUE_TITLE_LENGTH + 100)
    .optional(),
})

const isTrackerKind = (kind: string) => (TRACKER_KINDS as readonly string[]).includes(kind)

/**
 * A Jira Cloud site's address as its origin, or undefined when it is not an https address of a
 * named host (an IP, `localhost` or a bare name could aim the server at its own network).
 */
export function normalizeJiraSite(raw: string): string | undefined {
  const text = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  const host = url.hostname
  const named = host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
  if (url.protocol !== 'https:' || !named || host === 'localhost' || host.endsWith('.local')) {
    return undefined
  }
  return url.origin
}

/**
 * Issue trackers (Linear, Jira): connecting one to an organization, mapping its projects to a
 * Linear team or Jira project, and creating an issue from a build. Members of the organization
 * read and create issues; owners and admins connect and map. The tracker is always called
 * before anything is stored, so a failed call leaves no trace (502, or 400 for rejected
 * credentials while connecting).
 */
export const dashboardIssueTrackerRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const trackers = deps.trackers ?? createTrackerFactory()
  // TRANSITIONAL: these three paths are the generic mapping routes too (Fastify takes a path once),
  // so an integration of the registry is handed to them. Delete this and the three `claims` lines
  // when Linear and Jira are migrated to the SDK.
  const generic = genericMappingHandlers(deps)

  /** The adapter for an integration's sealed credentials; undefined when they cannot be opened. */
  function openTracker(integration: {
    kind: string
    encryptedCredentials: string | null
  }): IssueTracker | undefined {
    if (!deps.authSecret || !integration.encryptedCredentials) return undefined
    const plaintext = openSecret(deps.authSecret, integration.encryptedCredentials)
    return plaintext === undefined ? undefined : trackers(integration.kind, plaintext)
  }

  async function load(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    return { org: found.org, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
      return undefined
    }
    return found?.org
  }

  /** The tracker integration of the organization, or a 404. */
  async function loadTracker(orgId: string, id: string, reply: FastifyReply) {
    const integration = await getIntegration(deps.db, orgId, id)
    if (!integration || !isTrackerKind(integration.kind)) {
      await reply.code(404).send({ error: 'Integration not found' })
      return undefined
    }
    return integration
  }

  /** Verifies the credentials with the tracker, then stores the integration. Nothing is stored on failure. */
  async function connect(
    req: FastifyRequest,
    reply: FastifyReply,
    org: { id: string },
    kind: 'linear' | 'jira',
    credentials: IssueTracker.Credentials,
  ) {
    if (!deps.authSecret) {
      return reply.code(400).send({ error: 'This instance cannot store credentials' })
    }
    const tracker = trackers(kind, serializeCredentials(credentials))
    if (!tracker) return reply.code(400).send({ error: 'Those credentials look incomplete' })
    let account: IssueTracker.Account
    try {
      account = await tracker.identify()
    } catch (err) {
      if (isConnectionRevoked(err)) {
        return reply.code(400).send({ error: `${kindName(kind)} did not accept those credentials` })
      }
      req.log.warn({ err }, 'could not verify the tracker credentials')
      return reply.code(502).send({ error: `${kindName(kind)} did not answer; try again shortly` })
    }
    const created = await createIntegration(deps.db, {
      orgId: org.id,
      kind,
      displayName: account.name,
      externalId: account.externalId,
      encryptedCredentials: sealSecret(deps.authSecret, serializeCredentials(credentials)),
      createdBy: currentUser(req).id,
    })
    return reply.code(201).send({ id: created.id })
  }

  for (const kind of TRACKER_KINDS) {
    /** The connections of this kind and where each project files issues. */
    app.get(`/orgs/:org/integrations/${kind}`, async (req, reply) => {
      const found = await load(req, reply)
      if (!found) return reply
      const connections = (await listIntegrations(deps.db, found.org.id)).filter(
        (i) => i.kind === kind,
      )
      const mapped = new Map<
        string,
        { integrationId: string; target: string; targetName: string | null }
      >()
      for (const c of connections) {
        // eslint-disable-next-line no-await-in-loop -- a handful of connections
        for (const m of await listIntegrationProjects(deps.db, c.id)) {
          if (mapped.has(m.slug)) continue
          const name = m.extra.targetName
          mapped.set(m.slug, {
            integrationId: c.id,
            target: m.externalRef,
            targetName: typeof name === 'string' ? name : null,
          })
        }
      }
      const payload: Issue.Page = {
        canManage: found.canManage,
        connections: connections.map((c) => ({
          id: c.id,
          name: c.displayName,
          needsAttention: c.needsAttention,
        })),
        projects: (await listProjects(deps.db, found.org.slug)).map((p) => ({
          slug: p.slug,
          name: p.name,
          integrationId: mapped.get(p.slug)?.integrationId ?? null,
          target: mapped.get(p.slug)?.target ?? null,
          targetName: mapped.get(p.slug)?.targetName ?? null,
        })),
      }
      return payload
    })
  }

  app.post('/orgs/:org/integrations/linear', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { apiKey } = parse(linearBody, req.body)
    return connect(req, reply, org, 'linear', { kind: 'linear', apiKey })
  })

  app.post('/orgs/:org/integrations/jira', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const body = parse(jiraBody, req.body)
    const siteUrl = normalizeJiraSite(body.siteUrl)
    if (!siteUrl) {
      return reply
        .code(400)
        .send({ error: 'siteUrl: use the https address of your Jira Cloud site' })
    }
    return connect(req, reply, org, 'jira', {
      kind: 'jira',
      siteUrl,
      email: body.email,
      apiToken: body.apiToken,
    })
  })

  /** The teams or projects an issue can go to, for mapping a project. */
  app.get('/orgs/:org/integrations/:id/targets', async (req, reply) => {
    if (await generic.claims(req)) return generic.targets(req, reply)
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { id } = parse(z.object({ org: z.string(), id: z.uuid() }), req.params)
    const integration = await loadTracker(org.id, id, reply)
    if (!integration) return reply
    const tracker = openTracker(integration)
    if (!tracker) {
      return reply.code(400).send({ error: 'This connection cannot be used; connect it again' })
    }
    try {
      const targets: Issue.Target[] = await tracker.listTargets()
      return { targets }
    } catch (err) {
      return trackerFailed(req, reply, integration, err)
    }
  })

  /** Files a project's issues in a team or project of the tracker (replacing any earlier mapping of that kind). */
  app.put('/orgs/:org/integrations/:id/projects/:project', async (req, reply) => {
    if (await generic.claims(req)) return generic.put(req, reply)
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const params = parse(mappingParams, req.params)
    const integration = await loadTracker(org.id, params.id, reply)
    if (!integration) return reply
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: org.slug,
      projectSlug: params.project,
    }).catch(() => undefined)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const { target } = parse(targetBody, req.body)
    const tracker = openTracker(integration)
    if (!tracker) {
      return reply.code(400).send({ error: 'This connection cannot be used; connect it again' })
    }
    let found: IssueTracker.Target | undefined
    try {
      found = (await tracker.listTargets()).find((t) => t.ref === target)
    } catch (err) {
      return trackerFailed(req, reply, integration, err)
    }
    if (!found) return reply.code(400).send({ error: 'target: not found in that account' })
    const sameKind = (await listIntegrations(deps.db, org.id)).filter(
      (i) => i.kind === integration.kind && i.id !== integration.id,
    )
    for (const other of sameKind) {
      // eslint-disable-next-line no-await-in-loop -- a handful of connections
      await removeIntegrationProject(deps.db, other.id, project.id)
    }
    await setIntegrationProject(deps.db, {
      integrationId: integration.id,
      projectId: project.id,
      externalRef: found.ref,
      extra: { targetName: found.name },
    })
    return reply.code(204).send()
  })

  app.delete('/orgs/:org/integrations/:id/projects/:project', async (req, reply) => {
    if (await generic.claims(req)) return generic.remove(req, reply)
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const params = parse(mappingParams, req.params)
    const integration = await loadTracker(org.id, params.id, reply)
    if (!integration) return reply
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: org.slug,
      projectSlug: params.project,
    }).catch(() => undefined)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    await removeIntegrationProject(deps.db, integration.id, project.id)
    return reply.code(204).send()
  })

  async function trackerFailed(
    req: FastifyRequest,
    reply: FastifyReply,
    integration: OrgIntegration.Record,
    err: unknown,
  ) {
    if (!(err instanceof ProviderApiError)) throw err
    if (err.revoked) {
      await setIntegrationAttention(
        deps.db,
        integration.id,
        `${kindName(integration.kind)} no longer accepts the saved credentials`,
      )
    }
    req.log.warn({ err }, 'the issue tracker call failed')
    return reply
      .code(502)
      .send({ error: `${kindName(integration.kind)} did not accept the request: ${err.message}` })
  }

  async function loadBuild(req: FastifyRequest, reply: FastifyReply) {
    const access = await loadProject(deps, req, reply)
    if (!access) return undefined
    const number = Number(parse(buildParams, req.params).number)
    const build = Number.isInteger(number)
      ? await getBuildByNumber(deps.db, access.project.id, number)
      : undefined
    if (!build) {
      await reply.code(404).send({ error: 'Build not found' })
      return undefined
    }
    return { ...access, build }
  }

  /** The issues created from a build, and the trackers its project files issues in. */
  app.get('/projects/:org/:project/builds/:number/issues', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const [links, mapped] = await Promise.all([
      listBuildIssueLinks(deps.db, found.build.id),
      listProjectTrackers(deps.db, found.project.id),
    ])
    const payload: Issue.List = {
      issues: links.map((l) => ({
        id: l.id,
        key: l.issueKey,
        url: l.url,
        title: l.title,
        tracker: l.kind,
        snapshotName: l.snapshotName,
        createdAt: l.createdAt.toISOString(),
        createdBy: l.createdBy?.name ?? null,
      })),
      trackers: mapped
        .filter((m) => !m.needsAttention)
        .map((m) => ({
          integrationId: m.integrationId,
          kind: m.kind,
          name: m.displayName,
          target: m.externalRef,
        })),
    }
    return payload
  })

  app.post('/projects/:org/:project/builds/:number/issues', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const input = parse(createBody, req.body)
    try {
      const link = await createIssueFromBuild(deps.db, {
        buildId: found.build.id,
        integrationId: input.integrationId,
        snapshotName: input.snapshotName,
        title: input.title,
        userId: found.user.id,
        publicOrigin: deps.publicOrigin,
        openTracker,
      })
      const issue: Issue.Ref = { key: link.issueKey, url: link.url, title: link.title }
      return reply.code(201).send(issue)
    } catch (err) {
      if (!(err instanceof ProviderApiError)) throw err
      const org = await getOrganizationBySlug(deps.db, found.project.orgSlug)
      const integration = await getIntegration(deps.db, org.id, input.integrationId)
      if (integration) return trackerFailed(req, reply, integration, err)
      throw err
    }
  })
}

const kindName = (kind: string) => (kind === 'linear' ? 'Linear' : 'Jira')
