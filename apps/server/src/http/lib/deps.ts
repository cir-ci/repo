import type { Auth } from '@circi/auth'
import type { Database, SessionMethod, getProjectContext } from '@circi/db'
import type {
  FigmaClient,
  GitProvider,
  ProviderRegistry,
  SlackClient,
  GitlabProvider,
  TrackerFactory,
} from '@circi/providers'
import type { StorageDriver } from '@circi/storage'

export namespace Deps {
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
    /** This instance has a GitHub App: a linked project's check is then the merge gate. */
    githubApp?: boolean
    /** Static site hosting, when `STATIC_SITES_HOST` is set. */
    sites?: Deps.Sites
  }

  /** The Slack app's credentials and the client that talks to Slack. */
  export interface Slack {
    clientId: string
    clientSecret: string
    client: Pick<SlackClient, 'authorizeUrl' | 'exchangeCode' | 'listChannels'>
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
    /** This instance has a GitHub App, so projects can be linked to repositories. */
    githubApp?: boolean
    /** Git host adapters by connection kind (the repository picker asks them what they can see). */
    providers?: ProviderRegistry<Pick<GitProvider, 'listRepositories'>>
    /** Figma's REST API, for connecting an account and linking frames. */
    figma?: Pick<FigmaClient, 'me' | 'getFile' | 'listFrames' | 'getNodeNames'>
    /** The GitLab adapter, which also identifies a token's principal when a connection is added. */
    gitlab?: Pick<GitlabProvider, 'identify' | 'listRepositories'>
    /** The Slack app that installs into workspaces; absent unless `SLACK_CLIENT_ID` is set. */
    slack?: Deps.Slack
    /** Builds Linear and Jira adapters from stored credentials; replaceable in tests. Default: the real ones. */
    trackers?: TrackerFactory
    /** Static site hosting, when `STATIC_SITES_HOST` is set. */
    sites?: Deps.Sites
    /** Who may create organizations in the dashboard. Default: instance admins only. */
    orgCreation?: 'admin' | 'anyone'
    /** The instance secret, from which the first-run setup code is derived. */
    authSecret?: string
    /** Built web app (apps/web/dist). Missing: the API still works, pages explain how to build. */
    webDist?: string
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The project whose CI token authenticated this `/v1` request. */
    project?: getProjectContext.Context
    /** The signed-in user, inside the session-protected dashboard API. */
    user?: { id: string; email: string; name: string; method: SessionMethod; sessionId: string }
  }
}
