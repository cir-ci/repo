/** `/api/instance/…` for instance admins: accounts, workspaces, settings and health. */
export namespace InstanceAdmin {
  /** One account of the instance. */
  export interface Account {
    id: string
    email: string
    name: string
    /** Has better-auth's `admin` role. */
    instanceAdmin: boolean
    banned: boolean
    banReason: string | null
    /** When a temporary ban ends; null for none or a permanent one. */
    banExpires: string | null
    createdAt: string
    /** The newest session's start; null when the account has none (never signed in, or signed out everywhere). */
    lastSignInAt: string | null
    workspaceCount: number
  }

  /** `GET /api/instance/accounts?q=&page=&pageSize=` */
  export interface AccountList {
    accounts: Account[]
    total: number
    page: number
    pageSize: number
  }

  /** `POST /api/instance/accounts`: `password` is shown here once, null when the admin chose it. */
  export interface CreatedAccount {
    account: Account
    password: string | null
    /** Set when the account was created without a password and mailed a sign-in code instead. */
    signInCodeSentTo?: string
  }

  /** `POST /api/instance/accounts/:id/reset-password`: the new password, shown once. */
  export interface PasswordReset {
    password: string
  }

  export interface Workspace {
    id: string
    name: string
    slug: string
    memberCount: number
    teamCount: number
    /** Bytes of the distinct files the workspace's builds refer to. */
    storageBytes: number
    createdAt: string
    /** When an owner deleted it; null while it is live. A deleted workspace is purged 30 days later. */
    deletedAt: string | null
    /** Whole days until the purge (0 once due); null while it is live. */
    daysLeft: number | null
  }

  /** `GET /api/instance/workspaces` */
  export interface WorkspaceList {
    workspaces: Workspace[]
  }

  /** `GET /api/instance/settings`: the effective settings from the environment. No secret is in it. */
  export interface Settings {
    publicUrl: string
    /** Hosts that redirect to `publicUrl` (`PREVIOUS_PUBLIC_URLS`). */
    previousPublicHosts: string[]
    mail: {
      configured: boolean
      /** The From address; null without SMTP. */
      from: string | null
      host: string | null
      port: number | null
      secure: boolean | null
      /** An SMTP login is set (never the login itself). */
      authenticated: boolean
    }
    auth: {
      password: boolean
      /** Email sign-in codes are offered. */
      email: boolean
      sso: { id: string; name: string }[]
    }
    /** Who may create workspaces in the dashboard. */
    workspaceCreation: 'admin' | 'anyone'
    retention: {
      /** What a new team starts with, in days. */
      defaultTeamRetentionDays: number
      /** Hours an unused file waits before it is deleted. */
      gcGraceHours: number
      /** Minutes after which a build still uploading fails; 0 never. */
      uploadTimeoutMinutes: number
    }
    githubApp: {
      source: 'env' | 'manifest' | 'none'
      appId: string | null
    }
    staticSites: { host: string; maxMb: number } | null
    storage: { driver: 'fs' | 's3'; bucket: string | null }
    webhooksAllowPrivateAddresses: boolean
  }

  /** `POST /api/instance/mail/test`: always 200; `ok` says whether the mail was handed to SMTP. */
  export interface MailTest {
    ok: boolean
    /** The address the test mail went to (the admin's own). */
    to: string
    message: string
  }

  /** One doctor check: a label, what was found and the fact behind it. */
  export interface Finding {
    id: string
    /** `fail`: something CirCI needs does not work; `warn`: look at it; `info`: a note; `ok`: passes. */
    level: 'ok' | 'warn' | 'info' | 'fail'
    /** What was checked: `Database`, `Mail`. */
    label: string
    /** What was found, in a sentence: `Migrations are current.` */
    detail: string
    /** The fact behind it, for a mono font (a host, a path, `Postgres 18`); null when there is none. */
    value: string | null
    /** The finding as one sentence, as `circi admin doctor` prints it. */
    message: string
    fix: string | null
  }

  /** `GET /api/instance/health/checks` (it asks other hosts, so it can take several seconds). */
  export interface Checks {
    findings: Finding[]
    /** At least one finding is a `warn` or a `fail`. */
    warned: boolean
  }

  /** One step to finish after the dashboard's address changes. */
  export interface AddressStep {
    id: string
    title: string
    detail: string
    /** The exact values to set, e.g. redirect URIs. */
    values: string[]
  }

  /** `GET /api/instance/health/address-checklist`: what must change when `PUBLIC_URL` does, computed from the current configuration. */
  export interface AddressChecklist {
    publicUrl: string
    steps: AddressStep[]
    /** An admin dismissed the checklist for this address; it comes back when `PUBLIC_URL` changes. */
    dismissed: boolean
    /** The hosts the dashboard used to live on (`PREVIOUS_PUBLIC_URLS`): empty when no move is in progress. */
    previousHosts: string[]
  }

  export interface QueueDepth {
    queue: string
    pending: number
    running: number
    failed: number
    /** When the oldest pending job was due; null with none pending. */
    oldestPendingAt: string | null
    /** Pending jobs that already failed once and wait for their next attempt. */
    retrying: number
    /** The retrying job furthest along: its next attempt of the most it gets; null with none retrying. */
    mostRetried: { attempt: number; maxAttempts: number } | null
  }

  /** `GET /api/instance/health/queues`: jobs not yet done, per queue. */
  export interface Queues {
    queues: QueueDepth[]
  }
}
