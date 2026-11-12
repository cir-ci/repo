/** `/api/instance/…` for instance admins: accounts, workspaces, settings and health. */
export namespace InstanceAdmin {
  /** One account of the instance. */
  export interface Account {
    id: string
    email: string
    name: string
    /** The account's uploaded picture; null when it has none. */
    image: string | null
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

  /** `POST /api/instance/accounts/:id/email`: the account with its new address, and the one it had. */
  export interface EmailChanged {
    account: Account
    previousEmail: string
  }

  /** `POST /api/instance/accounts/:id/reset-password`: the new password, shown once. */
  export interface PasswordReset {
    password: string
  }

  export interface Workspace {
    id: string
    name: string
    slug: string
    /** Its uploaded picture's address; null when it has none. */
    picture: string | null
    memberCount: number
    projectCount: number
    /** Bytes of the distinct files the workspace's builds refer to. */
    storageBytes: number
    createdAt: string
    /** When an owner deleted it; null while it is live. A deleted workspace is purged 30 days later. */
    deletedAt: string | null
    /** Whole days until the purge (0 once due); null while it is live. */
    daysLeft: number | null
    /** The display name of its longest-standing owner; null when it has none. */
    ownerName: string | null
    /** Whether the signed-in instance admin belongs to it: only members may open its projects. */
    youAreMember: boolean
  }

  /** `POST /api/instance/workspaces/:id/join`: the signed-in instance admin is now an admin of it. */
  export interface Joined {
    workspace: Workspace
  }

  /** `GET /api/instance/workspaces` */
  export interface WorkspaceList {
    workspaces: Workspace[]
  }

  /** Where a setting's value comes from: its environment variable, the dashboard, or the default. */
  export type Source = 'env' | 'stored' | 'default'

  /** One editable setting. When `source` is `env` it is locked: "Set by <env>". */
  export interface Field<T> {
    value: T
    source: Source
    /** The variable that locks it; null unless `source` is `env`. */
    env: string | null
  }

  /** A single sign-on provider of the whole instance. No secret is in it: only whether one is saved. */
  export interface SsoProvider {
    id: 'github' | 'gitlab' | 'google' | 'oidc'
    name: string
    clientId: string
    /** The OpenID Connect issuer, or a self-managed GitLab's address. */
    issuer: string | null
    /** The operator vouches that the provider only reports addresses its users own. */
    trustedForEmail: boolean
    secretSaved: boolean
    unreadable?: string | null
    /** `env`: defined by `AUTH_<PROVIDER>_*` variables, read-only here. */
    source: 'env' | 'stored'
    env: string | null
  }

  /** The settings an instance admin can change (and the environment can lock). Secrets never appear. */
  export interface Config {
    /** Who may create workspaces in the dashboard. */
    workspaceCreation: Field<'admin' | 'anyone'>
    /** The sign-in methods the instance allows: the outer limit of every workspace's own. */
    signIn: { password: Field<boolean>; email: Field<boolean>; sso: Field<boolean> }
    limits: {
      /** Retention in days that a new project starts with. */
      defaultProjectRetentionDays: Field<number>
      /** Hours an unused file waits before it is deleted. */
      gcGraceHours: Field<number>
      /** Minutes after which a build still uploading fails; 0 never. */
      uploadTimeoutMinutes: Field<number>
      /** Days a finished background job is kept; 0 keeps them. */
      jobRetentionDays: Field<number>
      /** Largest hosted site, in MB. */
      staticSitesMaxMb: Field<number>
      /** Seconds a webhook receiver may take to answer. */
      webhookTimeoutSeconds: Field<number>
    }
    /** The mail server. */
    smtp: {
      source: 'env' | 'stored' | 'none'
      env: string | null
      host: string
      port: number
      secure: boolean
      user: string
      from: string
      /** A password is saved (never the password itself). */
      passwordSaved: boolean
      /** Set when the saved password can't be read with the current instance secret. */
      unreadable?: string | null
    }
    /** The Slack app that installs into workspaces. */
    slack: {
      source: 'env' | 'stored' | 'none'
      env: string | null
      clientId: string
      secretSaved: boolean
      unreadable?: string | null
    }
    /** Providers from the environment (read-only) and the ones added here. */
    sso: SsoProvider[]
  }

  /** `PUT /api/instance/config/smtp` */
  export interface SmtpInput {
    host: string
    port: number
    secure: boolean
    user: string
    from: string
    /** Absent keeps the saved password, a string replaces it, null removes it. */
    password?: string | null
  }

  /** `PUT /api/instance/config/slack` */
  export interface SlackInput {
    clientId: string
    /** Absent keeps the saved secret. */
    clientSecret?: string
  }

  /** `PUT /api/instance/config/sso/:id` */
  export interface SsoInput {
    name?: string
    clientId: string
    /** Absent keeps the saved secret. */
    clientSecret?: string
    issuer?: string
    trustedForEmail: boolean
  }

  /** `GET /api/instance/settings`. No secret is in it. */
  export interface Settings {
    publicUrl: string
    /** Hosts that redirect to `publicUrl` (`PREVIOUS_PUBLIC_URLS`). */
    previousPublicHosts: string[]
    config: Config
    githubApp: {
      source: 'env' | 'manifest' | 'none'
      appId: string | null
    }
    /** The sites domain (`STATIC_SITES_HOST`); null when hosting is not set up. */
    staticSites: { host: string } | null
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
