import type { Build } from './build.ts'

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
    retentionDays: number
    staticHostingEnabled: boolean
  }

  export interface Webhook {
    id: string
    url: string
    events: string[]
    enabled: boolean
    createdAt: string
  }

  export interface GithubLink {
    installationId: string
    repoRef: string
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
    webhooks: Webhook[]
    webhookEvents: string[]
    github: { configured: boolean; webhookUrl: string; link: GithubLink | null }
    /** Static site hosting is set up on this instance (`STATIC_SITES_HOST`). */
    sitesConfigured: boolean
  }
}
