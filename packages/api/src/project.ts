import type { Build } from './build.ts'
import type { Org } from './org.ts'

export namespace Project {
  export interface Overview {
    org: { slug: string; name: string }
    project: { slug: string; name: string; defaultBranch: string }
    latestBuild: Build.ListItem | null
  }

  export interface Info {
    id: string
    slug: string
    name: string
    defaultBranch: string
    orgSlug: string
    orgName: string
  }

  export interface Settings {
    name: string
    defaultBranch: string
    diffThreshold: number
    autoApproveDefaultBranch: boolean
    blockMergeOnChanges: boolean
    /** Whether a change to flaky screenshots only blocks the merge; null inherits the organization's. */
    flakyBlocksMerge: boolean | null
    retentionDays: number
    /** Hours a review request may wait before it is overdue; null means no review target. */
    reviewTargetHours: number | null
    staticHostingEnabled: boolean
  }

  export interface Webhook {
    id: string
    url: string
    events: string[]
    enabled: boolean
    createdAt: string
  }

  /** CirCI can't use the project's git connection and a person has to act. */
  export interface GitAttention {
    /** `installation_revoked`: GitHub says the App was uninstalled or suspended. */
    reason: 'installation_revoked'
    /** When it first failed (ISO). */
    since: string
  }

  export interface GithubLink {
    installationId: string
    repoRef: string
    /** Set while GitHub refuses the installation; cleared when a call succeeds or it is linked again. */
    attention: GitAttention | null
  }

  /** `GET /api/projects/:org/:project`: the project and a page of its builds. */
  export interface BuildsResponse {
    project: Info
    builds: Build.ListItem[]
    /** Set while the project's GitHub connection needs attention; null otherwise. */
    gitAttention: GitAttention | null
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
    /** The organization's settings, which a project inherits where its own value is null. */
    org: Org.Settings
    webhooks: Webhook[]
    webhookEvents: string[]
    github: { configured: boolean; webhookUrl: string; link: GithubLink | null }
    /** Static site hosting is set up on this instance (`STATIC_SITES_HOST`). */
    sitesConfigured: boolean
  }
}
