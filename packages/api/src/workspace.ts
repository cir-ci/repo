export namespace Workspace {
  export interface Capabilities {
    canCreateWorkspace: boolean
    /** Whether this person runs the instance (its admin pages and menu entries). */
    instanceAdmin: boolean
    manageableWorkspaces: { slug: string; name: string }[]
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

  /** A workspace's defaults for its teams. */
  export interface Settings {
    /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
    flakyBlocksMerge: boolean
    /** Days of retention a new team starts with (existing teams keep their own). */
    retentionDays: number
  }

  /** `GET /api/workspaces/:workspace`: what the General page shows. */
  export interface General {
    canManage: boolean
    /** Owners may delete the workspace. */
    isOwner: boolean
    name: string
    slug: string
  }

  /** `DELETE /api/workspaces/:workspace` (owners; body `{ confirm: <the workspace's slug> }`). */
  export interface Deleted {
    /** When the workspace will be purged for good. */
    purgeAt: string
  }

  /** A team and its own flaky-gate setting (null: it follows the workspace's default). */
  export interface TeamOverride {
    slug: string
    name: string
    flakyBlocksMerge: boolean | null
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
    /** Every team, to show which follow the defaults and which override them. */
    teams: TeamOverride[]
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
