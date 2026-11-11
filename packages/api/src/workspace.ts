import type { Project } from './project.ts'

export namespace Workspace {
  /** What a person is in a workspace. */
  export type Role = 'owner' | 'admin' | 'member'

  export interface Capabilities {
    canCreateWorkspace: boolean
    /** Whether this person runs the instance (its admin pages and menu entries). */
    instanceAdmin: boolean
    /** The instance admin's first-run setup has steps left (storage check, first project); false for everyone else. */
    setupPending: boolean
    /**
     * The slug of the workspace this person opened last, on any device; null when they never
     * did or can't open it any more (left, deleted). The landing page opens it.
     */
    lastWorkspace: string | null
    manageableWorkspaces: {
      slug: string
      name: string
      picture: string | null
      /** The person's role in it: owners and admins manage it. */
      role: Role
    }[]
    /** Workspaces that won't show their content to the way this session signed in. */
    refusingWorkspaces: { name: string; accepts: ('password' | 'email' | 'github' | 'google')[] }[]
    /** The instance can send mail (SMTP is set up): email notifications and sign-in codes work. */
    mailConfigured: boolean
  }

  export interface Auth {
    canManage: boolean
    settings: {
      emailLoginEnabled: boolean
      passwordLoginEnabled: boolean
      signinGithub: boolean
      signinGoogle: boolean
    }
    /** What the instance offers; a provider that is not set up gets no switch. */
    instance: { password: boolean; email: boolean; github: boolean; google: boolean }
  }

  /**
   * `GET /api/workspaces/:workspace/github-import`: the repositories of the workspace's GitHub
   * installations that no project is linked to yet (owners and admins).
   */
  export interface GithubRepositories {
    repositories: {
      /** The workspace's GitHub connection that sees the repository. */
      integration: string
      /** That connection's name (`Installation 42`). */
      installation: string
      /** `owner/name`. */
      ref: string
      private: boolean
    }[]
  }

  /** `POST /api/workspaces/:workspace/github-import`: the projects made, one per repository. */
  export interface GithubImport {
    projects: { slug: string; name: string; repository: string }[]
  }

  /**
   * `GET /api/workspaces/:workspace/member-projects`: the projects each person belongs to, as far as
   * the signed-in person may see them (an owner or admin sees all; a member only their own).
   * People in none of the visible projects have no entry.
   */
  export interface MemberProjects {
    projects: Record<
      string,
      { slug: string; name: string; color: Project.Color; icon: string | null }[]
    >
  }

  /** A workspace's defaults for its projects. */
  export interface Settings {
    /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
    flakyBlocksMerge: boolean
    /** Whether new triage items are assigned to whoever is on triage. */
    assignTriageToOnCall: boolean
    /** Days of retention a new project starts with (existing projects keep their own). */
    retentionDays: number
  }

  /** `GET /api/workspaces/:workspace`: what the General page shows. */
  export interface General {
    canManage: boolean
    /** Owners may delete the workspace. */
    isOwner: boolean
    name: string
    slug: string
    /** Where the workspace's picture is served from; null: it has none (the first letter shows). */
    picture: string | null
  }

  /** `PUT /api/workspaces/:workspace/picture`: the picture now in use. */
  export interface Picture {
    picture: string | null
  }

  /** How one member can sign in: `password`, `sso`, or a linked provider (`github`, `google`, `oidc`…). */
  export interface MemberSignIn {
    userId: string
    methods: string[]
  }

  /** `GET /api/workspaces/:workspace/members/sign-in`. */
  export interface MembersSignIn {
    members: MemberSignIn[]
  }

  /** `DELETE /api/workspaces/:workspace` (owners; body `{ confirm: <the workspace's slug> }`). */
  export interface Deleted {
    /** When the workspace will be purged for good. */
    purgeAt: string
  }

  /** A project and its own flaky-gate setting (null: it follows the workspace's default). */
  export interface ProjectOverride {
    slug: string
    name: string
    /** How the project's avatar looks. */
    color: Project.Color
    icon: string | null
    flakyBlocksMerge: boolean | null
    /** Null: follows the workspace's default. */
    assignTriageToOnCall: boolean | null
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
    /** Every project, to show which follow the defaults and which override them. */
    projects: ProjectOverride[]
  }

  /** A workspace's own single sign-on provider. */
  export interface SsoProvider {
    providerId: string
    issuer: string
    /** What to register as the redirect address at the identity provider. */
    redirectUri: string
  }

  export interface Domain {
    id: string
    domain: string
    verified: boolean
    dnsName?: string
    dnsValue?: string
  }
}
