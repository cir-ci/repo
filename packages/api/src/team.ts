import type { Build } from './build.ts'
import type { Workspace } from './workspace.ts'

export namespace Team {
  /** The team tile palette (`--circi-team-<colour>`). */
  export type Color = 'slate' | 'olive' | 'plum' | 'moss' | 'mauve' | 'graphite'

  /** How the team's tile looks; `icon` is a Lucide icon name, null shows the first letter. */
  export interface Appearance {
    color: Color
    icon: string | null
  }

  export interface Overview {
    workspace: { slug: string; name: string }
    team: { slug: string; name: string; defaultBranch: string; color: Color; icon: string | null }
    latestBuild: Build.ListItem | null
  }

  export interface Info {
    id: string
    slug: string
    name: string
    defaultBranch: string
    color: Color
    icon: string | null
    workspaceSlug: string
    workspaceName: string
  }

  /** `GET …/token`: facts about the team's current CI token (never the token itself). */
  export interface Token {
    canManage: boolean
    /** The start of the token ("circi_AbC1…"); null when the team has no token. */
    hint: string | null
    createdAt: string | null
    /** The person who issued it; null when unknown (the first token, or the person is gone). */
    createdBy: { id: string; name: string } | null
    /** When CI last authenticated with it (ISO); null if it never has. */
    lastUsedAt: string | null
  }

  /** `POST …/token`: the new token, shown only here, and its metadata. */
  export interface TokenRotated {
    token: string
    info: Token
  }

  export interface Settings {
    name: string
    defaultBranch: string
    diffThreshold: number
    autoApproveDefaultBranch: boolean
    blockMergeOnChanges: boolean
    /** Whether a change to flaky screenshots only blocks the merge; null inherits the workspace's. */
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

  /** CirCI can't use the team's git connection and a person has to act. */
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

  /** `GET /api/teams/:workspace/:team`: the team and a page of its builds. */
  export interface BuildsResponse {
    team: Info
    builds: Build.ListItem[]
    /** Set while the team's GitHub connection needs attention; null otherwise. */
    gitAttention: GitAttention | null
  }

  export interface SettingsResponse {
    canManage: boolean
    settings: Settings
    appearance: Appearance
    /** The workspace's settings, which a team inherits where its own value is null. */
    workspace: Workspace.Settings
    webhooks: Webhook[]
    webhookEvents: string[]
    github: { configured: boolean; webhookUrl: string; link: GithubLink | null }
    /** Static site hosting is set up on this instance (`STATIC_SITES_HOST`). */
    sitesConfigured: boolean
  }
}
