import type { Auth, Mailer } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database } from '@circi/db'
import type { getTeamContext } from '@circi/db/queries'
import type { SessionMethod } from '@circi/db/repositories'
import type { IntegrationDefinition, IntegrationRegistry } from '@circi/integrations'
import { type ProviderRegistry } from '@circi/integrations/git'
import type { StorageDriver } from '@circi/storage'

import type { Fetcher } from '#composition/doctor.ts'

export namespace Deps {
  /** Instance settings of the registry's integrations, a replaceable `fetch`, and (tests) another registry. */
  export type IntegrationsOption = Pick<IntegrationDefinition.Context, 'config' | 'fetch'> & {
    registry?: IntegrationRegistry
    /**
     * Brings `config` up to date with the instance settings other replicas may have changed
     * (the GitHub App created in the dashboard). Cheap to call: it reads at most once per TTL.
     * Called before each request is handled.
     */
    refresh?: () => Promise<void>
    /** Makes the next `refresh` read: called by the replica that just wrote the setting. */
    invalidate?: () => void
  }

  /** What every HTTP scope needs. */
  export interface Base {
    db: Database
    auth: Auth
    storage: StorageDriver
    /** Dashboard origin (`PUBLIC_URL`): build links, upload URLs, CSRF and better-auth's base. */
    publicOrigin: string
  }

  /** What the instance admin's pages read: the effective configuration and the mailer. */
  export interface Instance {
    config: Config
    /** Sends mail; absent without SMTP. */
    mailer?: Mailer
    /** How the doctor asks other hosts about cookies; replaceable in tests. Default: real HTTP. */
    fetchHost?: Fetcher
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
    /** The configuration behind Instance › Settings and Health; without it those routes answer 501. */
    instance?: Deps.Instance
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
