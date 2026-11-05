import type { Auth } from '@circi/auth'
import type { Database, ProjectContext, SessionMethod } from '@circi/db'
import type { StorageDriver } from '@circi/storage'

/** What the CI API (`/v1`) needs. */
export interface V1Deps {
  db: Database
  auth: Auth
  storage: StorageDriver
  /** Dashboard origin (`PUBLIC_URL`), used for build links and local-disk upload URLs. */
  publicOrigin: string
}

/** What the dashboard (sign-in, `/api` and the web app) needs. */
export interface DashboardDeps {
  db: Database
  auth: Auth
  storage: StorageDriver
  /** Dashboard origin (`PUBLIC_URL`); better-auth's requests are built against it. */
  publicOrigin: string
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
    user?: { id: string; email: string; name: string; method: SessionMethod }
  }
}
