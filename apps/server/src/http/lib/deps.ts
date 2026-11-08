import type { Auth } from '@circi/auth'
import type { Database, SessionMethod, getTeamContext } from '@circi/db'
import type { IntegrationDefinition, IntegrationRegistry } from '@circi/integrations'
import type { ProviderRegistry } from '@circi/providers'
import type { StorageDriver } from '@circi/storage'

export namespace Deps {
  /** Instance settings of the registry's integrations, a replaceable `fetch`, and (tests) another registry. */
  export type IntegrationsOption = Pick<IntegrationDefinition.Context, 'config' | 'fetch'> & {
    registry?: IntegrationRegistry
  }

  /** What every HTTP scope needs. */
  export interface Base {
    db: Database
    auth: Auth
    storage: StorageDriver
    /** Dashboard origin (`PUBLIC_URL`): build links, upload URLs, CSRF and better-auth's base. */
    publicOrigin: string
  }

  /** What the CI API (`/v1`) needs. */
  export interface V1 extends Deps.Base {
    /** This instance has a GitHub App: a linked team's check is then the merge gate. */
    githubApp?: boolean
    /** Whether a GitHub App exists now, also one created in the dashboard (the one-click flow). */
    githubAppNow?: () => boolean
    /** Static site hosting, when `STATIC_SITES_HOST` is set. */
    sites?: Deps.Sites
  }

  /** Hosted static sites: where they live and who may open them (PLAN §7.6). */
  export interface Sites {
    /** The sites domain, e.g. `example-sites.com`. */
    host: string
    /** Largest site accepted, in bytes. */
    maxBytes: number
    /** The full address of a site's hostname label, with the dashboard's scheme and port. */
    originFor(label: string): string
  }

  /** What the Argos-compatible API (`/v2`) needs: the same as the CI API. */
  export type V2 = Deps.V1

  /** What the dashboard (sign-in, `/api` and the web app) needs. */
  export interface Dashboard extends Deps.Base {
    /** Email sign-in codes are offered (`AUTH_EMAIL_ENABLED` and SMTP configured). Default off. */
    emailLogin?: boolean
    /** Email + password sign-in is offered. Default on. */
    passwordLogin?: boolean
    /** Single sign-on buttons to offer (the providers are configured in `createAuth`). */
    sso?: { id: string; name: string }[]
    /** Webhooks may point at private addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). Default off. */
    webhookAllowPrivate?: boolean
    /** Looks up TXT records for domain verification; replaceable in tests. Default: real DNS. */
    resolveTxt?: (name: string) => Promise<string[][]>
    /**
     * This instance's GitHub App comes from the environment (`GITHUB_APP_*`), so teams can be
     * linked to repositories and the one-click setup is off. An App created in the dashboard
     * lives in `integrations.config.github` instead.
     */
    githubApp?: boolean
    /** `GITHUB_API_URL` (GitHub Enterprise Server): where the one-click flow creates the App. */
    githubApiUrl?: string
    /** Stands in for the git host adapters by connection kind (tests fake the host's edge); production uses the definitions'. */
    providers?: ProviderRegistry<object>
    /**
     * Instance settings of the registry's integrations (`config`: the Slack app, set by
     * `SLACK_CLIENT_ID`…) and a replaceable `fetch` for their HTTP calls (tests). `registry`
     * replaces the real one in tests of the generic routes.
     */
    integrations?: Deps.IntegrationsOption
    /** Static site hosting, when `STATIC_SITES_HOST` is set. */
    sites?: Deps.Sites
    /** Who may create workspaces in the dashboard. Default: instance admins only. */
    workspaceCreation?: 'admin' | 'anyone'
    /** The instance secret, from which the first-run setup code is derived. */
    authSecret?: string
    /** Built web app (apps/web/dist). Missing: the API still works, pages explain how to build. */
    webDist?: string
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The team whose CI token authenticated this `/v1` request. */
    team?: getTeamContext.Context
    /** The signed-in user, inside the session-protected dashboard API. */
    user?: { id: string; email: string; name: string; method: SessionMethod; sessionId: string }
  }
}
