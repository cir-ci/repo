import type { Auth } from '@circi/auth'
import type { Database, ProjectContext } from '@circi/db'
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
  /** Built web app (apps/web/dist). Missing: the API still works, pages explain how to build. */
  webDist?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The project whose CI token authenticated this `/v1` request. */
    project?: ProjectContext
    /** The signed-in user, inside the session-protected dashboard API. */
    user?: { id: string; email: string; name: string }
  }
}
