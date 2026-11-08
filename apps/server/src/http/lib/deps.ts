import type { Auth } from '@circi/auth'
import type { Database, ProjectContext, SessionMethod } from '@circi/db'
import type { StorageDriver } from '@circi/storage'

/** What every HTTP scope needs. */
export interface BaseDeps {
  db: Database
  auth: Auth
  storage: StorageDriver
  /** Dashboard origin (`PUBLIC_URL`): build links, upload URLs, CSRF and better-auth's base. */
  publicOrigin: string
}

/** What the CI API (`/v1`) needs. */
export interface V1Deps extends BaseDeps {
  /** This instance has a GitHub App: a linked project's check is then the merge gate. */
  githubApp?: boolean
  /** Static site hosting, when `STATIC_SITES_HOST` is set. */
  sites?: SitesDeps
}

/** Hosted static sites: where they live and who may open them (PLAN §7.6). */
export interface SitesDeps {
  /** The sites domain, e.g. `example-sites.com`. */
  host: string
  /** Largest site accepted, in bytes. */
  maxBytes: number
  /** The full address of a site's hostname label, with the dashboard's scheme and port. */
  originFor(label: string): string
}

/** What the Argos-compatible API (`/v2`) needs: the same as the CI API. */
export type V2Deps = V1Deps

/** What the dashboard (sign-in, `/api` and the web app) needs. */
export interface DashboardDeps extends BaseDeps {
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
  /** This instance has a GitHub App, so projects can be linked to repositories. */
  githubApp?: boolean
  /** Static site hosting, when `STATIC_SITES_HOST` is set. */
  sites?: SitesDeps
  /** Who may create organizations in the dashboard. Default: instance admins only. */
  orgCreation?: 'admin' | 'anyone'
  /** The instance secret, from which the first-run setup code is derived. */
  authSecret?: string
  /** Built web app (apps/web/dist). Missing: the API still works, pages explain how to build. */
  webDist?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The project whose CI token authenticated this `/v1` request. */
    project?: ProjectContext
    /** The signed-in user, inside the session-protected dashboard API. */
    user?: { id: string; email: string; name: string; method: SessionMethod; sessionId: string }
  }
}
