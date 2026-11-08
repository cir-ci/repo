export namespace Workspace {
  export interface Capabilities {
    canCreateWorkspace: boolean
    /** Whether this person runs the instance (its admin pages and menu entries). */
    instanceAdmin: boolean
    manageableWorkspaces: { slug: string; name: string }[]
    /** Workspaces that won't show their content to the way this session signed in. */
    refusingWorkspaces: { name: string; accepts: ('password' | 'email')[] }[]
  }

  export interface Auth {
    canManage: boolean
    settings: { emailLoginEnabled: boolean; passwordLoginEnabled: boolean }
    instance: { password: boolean; email: boolean }
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
    name: string
    slug: string
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
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
