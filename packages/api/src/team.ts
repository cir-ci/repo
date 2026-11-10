import type { Build } from './build.ts'
import type { Workspace } from './workspace.ts'

export namespace Team {
  /** The team tile palette (`--circi-team-<colour>`). */
  export type Color = 'slate' | 'olive' | 'plum' | 'moss' | 'mauve' | 'graphite'

  /** How the team's tile looks; `icon` is a Lucide icon name, null shows only the marble. */
  export interface Appearance {
    color: Color
    icon: string | null
  }

  /** A person shown in a team's member preview. */
  export interface MemberPreview {
    id: string
    name: string
    image: string | null
  }

  /** What the team lists (sidebar, Teams page) say about a team's people. */
  export interface MemberSummary {
    /** People in the team. */
    memberCount: number
    /** The first few members by name, up to five. */
    memberPreview: MemberPreview[]
    /** Whether the signed-in person belongs to the team (owners and admins see teams they don't). */
    youAreMember: boolean
  }

  export interface Overview {
    workspace: { slug: string; name: string; picture: string | null }
    team: {
      slug: string
      name: string
      defaultBranch: string
      color: Color
      icon: string | null
    } & MemberSummary
    latestBuild: Build.ListItem | null
  }

  /** One person in a team. */
  export interface Member {
    /** The user's ID. */
    id: string
    name: string
    email: string
    image: string | null
    /** The person's role in the team's workspace (roles are workspace-wide). */
    role: 'owner' | 'admin' | 'member'
    /** When they joined the team (ISO). */
    addedAt: string
  }

  /** `GET`/`POST /api/teams/:workspace/:team/members`: the team's people, by name. */
  export interface MemberList {
    members: Member[]
    /** Whether the signed-in person may add and remove anyone (owners and admins). */
    canManage: boolean
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
    /** The team's address: `<workspace>/<slug>`. Changing it breaks links to the old one. */
    slug: string
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
    /** The newest delivery attempts (at most 20), newest first. */
    deliveries: WebhookDelivery[]
  }

  /** One attempt to deliver one event to a webhook. */
  export interface WebhookDelivery {
    /** The `CirCI-Delivery` id; every retry of one event shares it. */
    deliveryId: string
    event: string
    /** A "Send test" event. */
    test: boolean
    /** 1 for the first try, 2 for the first retry, … */
    attempt: number
    /** What the receiver answered; null when it could not be reached (see `error`). */
    statusCode: number | null
    error: string | null
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
