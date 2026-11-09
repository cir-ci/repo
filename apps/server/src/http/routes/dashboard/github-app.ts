import type { Instance, Integration } from '@circi/api'
import { signState, verifyState } from '@circi/core'
import { isInstanceAdmin } from '@circi/db'
import {
  buildGithubManifest,
  convertGithubManifestCode,
  defaultGithubAppName,
  GITHUB_APP_NAME_MAX,
  githubManifestPostUrl,
} from '@circi/providers'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import {
  githubApiUrl,
  githubAppSource,
  publicUrlProblem,
  readStoredGithubApp,
  resolveGithubApp,
  storeGithubApp,
} from '#http/lib/github-app.ts'
import { INSTALL_FLOW } from '#http/lib/install-state.ts'
import { integrationContext } from '#http/lib/integration-context.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

/**
 * Creating the instance's GitHub App with one click (GitHub's App Manifest flow); nothing is
 * hosted outside this instance.
 *
 *   GET  /api/instance/github-app            status (no secrets)
 *   POST /api/instance/github-app/manifest   instance admin: the manifest and the address to post it to
 *   GET  /api/instance/github-app/callback   GitHub's redirect with a one-time `code`: stores the App, then sends the admin to install it
 *   GET  /api/workspaces/:workspace/integrations/github/install   the install address for a workspace
 *
 * Every `state` is signed, expires, and names the user it was issued to. The installation's own
 * return (`/api/integrations/github/setup`) is in `integrations-generic.ts`, which shares the
 * generic connect.
 */

/** `state` of the manifest round trip (30 minutes: creating an App on GitHub takes a while). */
const MANIFEST_STATE = 'github-manifest'

const manifestBody = z.strictObject({
  name: z.string().trim().min(1).max(GITHUB_APP_NAME_MAX).optional(),
  organization: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,39}$/, 'A GitHub organization name has letters, digits and dashes')
    .optional(),
})
const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
})
const workspaceParams = z.object({ workspace: z.string() })

export const dashboardGithubAppRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const adminOnly = 'Only instance admins can set up the GitHub App'

  app.get('/instance/github-app', async (req) => {
    const source = githubAppSource(deps)
    const stored =
      source === 'manifest' && deps.authSecret
        ? await readStoredGithubApp(deps.db, deps.authSecret)
        : undefined
    const resolved = source === 'env' ? await resolveGithubApp(deps) : null
    const problem = publicUrlProblem(deps.publicOrigin)
    const payload: Instance.GithubApp = {
      source,
      canManage: await isInstanceAdmin(deps.db, currentUser(req).id),
      appId: stored?.appId ?? deps.integrations?.config.github?.appId ?? null,
      slug: stored?.slug ?? resolved?.slug ?? null,
      htmlUrl: stored?.htmlUrl ?? resolved?.htmlUrl ?? null,
      warning: problem.warning,
      blocked: problem.blocked,
      defaultName: defaultGithubAppName(deps.publicOrigin),
    }
    return payload
  })

  app.post('/instance/github-app/manifest', async (req, reply) => {
    const user = currentUser(req)
    if (!(await isInstanceAdmin(deps.db, user.id)))
      return reply.code(403).send({ error: adminOnly })
    const ctx = integrationContext(deps)
    if (!ctx) return reply.code(400).send({ error: 'This instance cannot store credentials' })
    if (githubAppSource(deps) === 'env') {
      return reply
        .code(409)
        .send({ error: 'The GitHub App is configured by GITHUB_APP_* in the environment' })
    }
    const { blocked } = publicUrlProblem(deps.publicOrigin)
    if (blocked) return reply.code(400).send({ error: blocked })
    const body = parse(manifestBody, req.body ?? {})
    const payload: Instance.GithubManifest = {
      manifest: {
        ...buildGithubManifest({
          publicUrl: deps.publicOrigin,
          ...(body.name ? { name: body.name } : {}),
        }),
      },
      postUrl: githubManifestPostUrl(githubApiUrl(deps), body.organization),
      state: signState(
        ctx.authSecret,
        { kind: MANIFEST_STATE, userId: user.id },
        { ttlMs: 30 * 60_000 },
      ),
    }
    return payload
  })

  app.get('/instance/github-app/callback', async (req, reply) => {
    const user = currentUser(req)
    const query = parse(callbackQuery, req.query)
    const ctx = integrationContext(deps)
    const claims = ctx && query.state ? verifyState(ctx.authSecret, query.state) : undefined
    if (!ctx || claims?.kind !== MANIFEST_STATE) {
      return reply
        .code(400)
        .send({ error: 'This link is invalid or has expired; start the GitHub App setup again' })
    }
    if (claims.userId !== user.id) {
      return reply.code(400).send({ error: 'This setup was started by someone else' })
    }
    if (!(await isInstanceAdmin(deps.db, user.id))) {
      return reply.code(403).send({ error: adminOnly })
    }
    if (githubAppSource(deps) === 'env') {
      return reply
        .code(409)
        .send({ error: 'The GitHub App is configured by GITHUB_APP_* in the environment' })
    }
    const failed = () => reply.redirect('/instance?githubApp=failed')
    if (!query.code) return failed()
    const apiUrl = githubApiUrl(deps)
    let credentials
    try {
      credentials = await convertGithubManifestCode(apiUrl, query.code, ctx.fetch)
      await storeGithubApp(deps.db, ctx.authSecret, { ...credentials, apiUrl })
    } catch (err) {
      // Typically a code used twice: GitHub answers 404 for the second try.
      req.log.warn({ err }, 'could not create the GitHub App from the manifest')
      return failed()
    }
    // The running server uses the App from now on (the live object the routes, webhook and worker share).
    if (deps.integrations) {
      deps.integrations.config.github = {
        apiUrl,
        appId: credentials.appId,
        privateKey: credentials.privateKey,
        webhookSecret: credentials.webhookSecret,
      }
      // This replica now knows the new App; its next read of the setting must not be a cached one.
      deps.integrations.invalidate?.()
    }
    const install = signState(ctx.authSecret, {
      kind: 'github',
      flow: INSTALL_FLOW,
      userId: user.id,
    })
    return reply.redirect(
      `${credentials.htmlUrl}/installations/new?state=${encodeURIComponent(install)}`,
    )
  })

  /** Where a workspace admin goes to install the App on GitHub; `state` names the workspace and the user. */
  app.get('/workspaces/:workspace/integrations/github/install', async (req, reply) => {
    const found = await loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can manage integrations',
    })
    const { workspace: slug } = parse(workspaceParams, req.params)
    const ctx = integrationContext(deps)
    if (!ctx) return reply.code(400).send({ error: 'This instance cannot store credentials' })
    if (githubAppSource(deps) === 'none') {
      return reply.code(400).send({ error: 'This instance has no GitHub App set up' })
    }
    const stored =
      githubAppSource(deps) === 'manifest'
        ? await readStoredGithubApp(deps.db, ctx.authSecret)
        : undefined
    const htmlUrl = stored?.htmlUrl ?? (await resolveGithubApp(deps))?.htmlUrl
    if (!htmlUrl) {
      return reply
        .code(502)
        .send({ error: 'GitHub did not say where the App is installed; try again shortly' })
    }
    const state = signState(ctx.authSecret, {
      kind: 'github',
      flow: INSTALL_FLOW,
      userId: found.user.id,
      workspaceId: found.workspace.id,
      workspaceSlug: slug,
    })
    const payload: Integration.Install = {
      url: `${htmlUrl}/installations/new?state=${encodeURIComponent(state)}`,
    }
    return payload
  })
}
