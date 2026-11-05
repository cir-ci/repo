/**
 * The dashboard API's wire format: what `/api/*` sends as JSON and `apps/web` reads. One
 * definition, shared by both sides, so a change can't typecheck on one and break the other.
 *
 * Types only, grouped in a namespace per resource (`Build.Detail`, `Project.Settings`…). Dates
 * are ISO strings here because that is what JSON carries. The server checks its read models
 * against these in `apps/server/src/contract-check.ts`.
 */

export type BuildStatus = 'pending' | 'uploading' | 'processing' | 'complete' | 'error' | 'expired'
export type BuildConclusion = 'no_changes' | 'changes_detected'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type ReviewState = 'approved' | 'rejected'
export type ReviewSource = 'ui' | 'github-check' | 'github-comment' | 'auto' | 'rerun'
export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'

export namespace Build {
  export interface Counts {
    added: number
    removed: number
    changed: number
    unchanged: number
    failed: number
    total: number
  }

  export interface ListItem {
    id: string
    number: number
    name: string
    commitSha: string
    branch: string | null
    prNumber: number | null
    status: BuildStatus
    conclusion: BuildConclusion | null
    reviewStatus: ReviewStatus
    createdAt: string
    counts: Counts
  }

  export interface ImageRef {
    sha256: string
    width: number | null
    height: number | null
  }

  export interface DiffItem {
    id: string
    name: string
    status: DiffStatus | null
    score: number | null
    changedPixels: number | null
    sizeChanged: boolean
    errorMessage: string | null
    head: (ImageRef & { thumbnail: string | null; metadata: Record<string, unknown> }) | null
    base: (ImageRef & { thumbnail: string | null }) | null
    diff: ImageRef | null
  }

  /** One approve/reject decision. */
  export interface Review {
    state: ReviewState
    source: ReviewSource
    /** Null for automatic approvals. */
    userName: string | null
    createdAt: string
  }

  export interface Detail {
    project: Project.Info
    build: ListItem & {
      baseBranch: string | null
      ancestryStatus: 'ok' | 'missing' | 'truncated'
      baselineSource: 'cli' | 'sdk' | 'provider' | 'fallback' | 'none' | null
      errorMessage: string | null
      completedAt: string | null
    }
    baseline: { number: number; commitSha: string; branch: string | null } | null
    /** Decisions, newest first. */
    reviews: Review[]
    diffs: DiffItem[]
  }
}

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

export namespace Flaky {
  /** Screenshots that keep changing on the default branch, where nobody reviews them. */
  export interface Report {
    /** How many recent default-branch builds were looked at. */
    builds: number
    flaky: { name: string; changedIn: number }[]
  }
}

export namespace Site {
  /** A hosted site of a project, with the addresses that open it. */
  export interface Listing {
    name: string
    kind: string
    kindLabel: string
    slug: string
    /** Branches that have an address: the newest first, each serving the version it names. */
    branches: { branch: string; address: string; commitSha: string; updatedAt: string }[]
    /** Recent uploads, newest first. */
    versions: {
      commitSha: string
      branch: string | null
      createdAt: string
      totalBytes: number
      address: string | null
    }[]
  }

  export interface List {
    /** Static site hosting is set up on this instance. */
    configured: boolean
    sites: Listing[]
  }
}

export namespace Org {
  export interface Capabilities {
    canCreateOrganization: boolean
    manageableOrganizations: { slug: string; name: string }[]
    /** Organizations that won't show their content to the way this session signed in. */
    refusingOrganizations: { name: string; accepts: ('password' | 'email')[] }[]
  }

  export interface Auth {
    canManage: boolean
    settings: { emailLoginEnabled: boolean; passwordLoginEnabled: boolean }
    instance: { password: boolean; email: boolean }
  }

  /** An organization's own single sign-on provider. */
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

export namespace Instance {
  export interface AuthMethods {
    password: boolean
    email: boolean
    sso: { id: string; name: string }[]
  }

  export interface Notices {
    publicUrlChange: { from: string; to: string; at: string; checklist: string[] } | null
  }
}
