export namespace Integration {
  /** Mirrors `IntegrationGroup` in `@circi/core` (api depends on nothing); `contract-check.ts` fails if they drift. */
  export type Group = 'git' | 'chat' | 'design' | 'tracker'

  /** `kind` is the provider (`github`, `slack`…); the catalog lists the possible values. */
  export interface Item {
    /** Connection id (git hosts) or integration id (everything else). */
    id: string
    /** Which table the id belongs to; `DELETE /integrations/:source/:id`. */
    source: 'connection' | 'integration'
    kind: string
    group: Group
    /** The account, workspace or installation it is connected to. */
    name: string
    /** CirCI can't use the connection and a person has to act. */
    needsAttention: boolean
    attentionReason: string | null
    /** Projects of the organisation that use it (a repository, channel, team or file each). */
    projectCount: number
    createdAt: string
  }

  /** One provider in the Add dialog. */
  export interface CatalogEntry {
    kind: string
    group: Group
    name: string
    description: string
    status: 'available' | 'planned'
    /** This release has a provider and add flow for it (`available` entries not built say "Coming soon"). */
    built: boolean
    /** Available, and this instance can connect it (GitHub needs a GitHub App configured). */
    connectable: boolean
  }

  /** `GET /api/orgs/:org/integrations`. */
  export interface ListResponse {
    canManage: boolean
    integrations: Item[]
    catalog: CatalogEntry[]
  }

  /** A repository a git connection can see. */
  export interface Repository {
    ref: string
    private: boolean
  }

  /** `GET /api/orgs/:org/integrations/github`: the GitHub connections and the repository each project reports to. */
  export interface GithubPage {
    canManage: boolean
    configured: boolean
    webhookUrl: string
    connections: { id: string; installationId: string; needsAttention: boolean }[]
    projects: {
      slug: string
      name: string
      repoRef: string | null
      installationId: string | null
    }[]
  }

  /** `GET /api/orgs/:org/integrations/bitbucket`: the Bitbucket workspaces and the repository each project reports to. */
  export interface BitbucketPage {
    canManage: boolean
    webhookUrl: string
    /** The secret to put on the Bitbucket webhook; only owners and admins get it. */
    webhookSecret: string | null
    connections: { id: string; workspace: string; needsAttention: boolean }[]
    projects: {
      slug: string
      name: string
      repoRef: string | null
      /** The Bitbucket connection it reports through. */
      connectionId: string | null
    }[]
  }

  /** `GET /api/orgs/:org/integrations/gitlab`: the GitLab connections and the GitLab project each CirCI project reports to. */
  export interface GitlabPage {
    canManage: boolean
    webhookUrl: string
    /** The secret token to put on the GitLab webhook; only owners and admins get it. */
    webhookSecret: string | null
    connections: {
      id: string
      /** `host#user id` of the token's principal. */
      name: string
      needsAttention: boolean
    }[]
    projects: {
      slug: string
      name: string
      /** The GitLab project's path with namespace, e.g. `acme/tools/web`. */
      repoRef: string | null
      /** The GitLab connection it reports through. */
      connectionId: string | null
    }[]
  }
}
