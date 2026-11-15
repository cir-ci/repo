import { join } from 'node:path'

/** Where things are and which ports they use; every port can be moved with an environment variable. */
export const REPO_ROOT = join(import.meta.dirname, '..', '..')
export const COMPOSE_FILE = join(REPO_ROOT, 'dev', 'compose.yml')
/** Files, seed state and the seed's git repository (gitignored). `pnpm dev:reset` deletes it. */
export const WEBHOOK_RECEIVER_MAIN = join(REPO_ROOT, 'dev', 'src', 'webhook-receiver.ts')
export const STATE_DIR = join(REPO_ROOT, '.dev')
/** The signing secrets the seed got for its webhooks (the API shows each once); the receiver reads them. */
export const WEBHOOK_SECRETS_FILE = join(STATE_DIR, 'webhook-secrets.json')
export const SERVER_MAIN = join(REPO_ROOT, 'apps', 'server', 'src', 'main.ts')
export const WEB_DIR = join(REPO_ROOT, 'apps', 'web')

const port = (name: string, fallback: number): number => {
  const raw = process.env[name]
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a port number, got "${raw}"`)
  }
  return value
}

export const PORTS = {
  server: port('CIRCI_DEV_PORT', 3000),
  web: port('CIRCI_DEV_WEB_PORT', 5173),
  postgres: port('CIRCI_DEV_POSTGRES_PORT', 54329),
  smtp: port('CIRCI_DEV_SMTP_PORT', 1025),
  mail: port('CIRCI_DEV_MAIL_PORT', 8025),
  /** The local webhook receiver. 4747 is outside the other dev ports (3000, 5173, 54329, 1025, 8025) and the e2e stacks use Docker-assigned ports. */
  hooks: port('CIRCI_DEV_HOOKS_PORT', 4747),
}

export const URLS = {
  /** The API, for `circi upload` and the seed (the dashboard proxies `/api` here). */
  server: `http://localhost:${PORTS.server}`,
  /** The dashboard, served by Vite with hot reload: PUBLIC_URL, so sign-in cookies and links use it. */
  web: `http://localhost:${PORTS.web}`,
  mail: `http://localhost:${PORTS.mail}`,
  hooks: `http://localhost:${PORTS.hooks}`,
}

/** A seeded account (every one signs in with `SEED.password`; it is for this local database only). */
export interface Person {
  email: string
  name: string
}

export const PEOPLE = {
  owner: { email: 'owner@example.com', name: 'Olivia Owner' },
  member: { email: 'member@example.com', name: 'Max Member' },
  priya: { email: 'priya.nair@example.com', name: 'Priya Nair' },
  daniel: { email: 'daniel.okafor@example.com', name: 'Daniel Okafor' },
  sofia: { email: 'sofia.rossi@example.com', name: 'Sofia Rossi' },
  liam: { email: 'liam.chen@example.com', name: 'Liam Chen' },
  hannah: { email: 'hannah.weber@example.com', name: 'Hannah Weber' },
  tomas: { email: 'tomas.novak@example.com', name: 'Tomas Novak' },
  amara: { email: 'amara.diallo@example.com', name: 'Amara Diallo' },
  elena: { email: 'elena.garcia@northwind.example', name: 'Elena Garcia' },
  kwame: { email: 'kwame.mensah@northwind.example', name: 'Kwame Mensah' },
  /** The instance admin, who is not in Acme. */
  ines: { email: 'ines.ibarra@example.com', name: 'Ines Ibarra' },
} as const satisfies Record<string, Person>
export type PersonKey = keyof typeof PEOPLE

export interface SeedWorkspace {
  name: string
  slug: string
  owner: PersonKey
  /** Everyone besides the owner. */
  members: readonly { who: PersonKey; role: 'admin' | 'member' }[]
  /** An email domain the workspace claims (marked verified with SQL: the check needs DNS). */
  domain?: string
  /** Deleted by its owner through the API once the seed is done: it shows in Deleted workspaces. */
  deleted?: boolean
  /** Invitations that stay pending. */
  invitations?: readonly { email: string; role: 'admin' | 'member' }[]
  /** The defaults for its projects, as the workspace settings page saves them. */
  settings?: { flakyBlocksMerge?: boolean; assignTriageToOnCall?: boolean; retentionDays?: number }
}

export const WORKSPACES: readonly SeedWorkspace[] = [
  {
    name: 'Acme',
    slug: 'acme',
    owner: 'owner',
    members: [
      { who: 'priya', role: 'admin' },
      { who: 'daniel', role: 'admin' },
      { who: 'member', role: 'member' },
      { who: 'sofia', role: 'member' },
      { who: 'liam', role: 'member' },
      { who: 'hannah', role: 'member' },
      { who: 'tomas', role: 'member' },
      { who: 'amara', role: 'member' },
    ],
    invitations: [
      { email: 'new.hire@example.com', role: 'member' },
      { email: 'contractor@example.com', role: 'admin' },
    ],
    settings: { flakyBlocksMerge: true, assignTriageToOnCall: true, retentionDays: 180 },
  },
  {
    name: 'Northwind',
    slug: 'northwind',
    owner: 'elena',
    members: [
      { who: 'kwame', role: 'admin' },
      { who: 'priya', role: 'member' },
      { who: 'member', role: 'member' },
      { who: 'ines', role: 'member' },
    ],
    domain: 'northwind.example',
    invitations: [{ email: 'seasonal@northwind.example', role: 'member' }],
    settings: { flakyBlocksMerge: false, assignTriageToOnCall: false, retentionDays: 90 },
  },
  {
    name: 'Pixel Studio',
    slug: 'pixel-studio',
    owner: 'sofia',
    members: [
      { who: 'owner', role: 'admin' },
      { who: 'tomas', role: 'member' },
    ],
    settings: { retentionDays: 365 },
  },
  {
    name: 'Old Labs',
    slug: 'old-labs',
    owner: 'daniel',
    members: [{ who: 'amara', role: 'member' }],
    deleted: true,
  },
]

export interface SeedProject {
  workspace: string
  name: string
  slug: string
  /** One of core's `PROJECT_COLORS`. */
  color: string
  /** A Lucide icon name. */
  icon: string
  /** Who is in the project (a workspace's owners and admins see every project anyway). */
  members: readonly PersonKey[]
  /** Who takes turns being on triage, in order. */
  rotation: readonly PersonKey[]
  /** Review rules: who is asked to review what. */
  rules: readonly {
    kind: 'snapshot-name' | 'build-name'
    pattern: string
    reviewers: PersonKey[]
  }[]
  /** Who has the project pinned in their sidebar. */
  pinnedBy: readonly PersonKey[]
  /**
   * What the project settings page saves (`PATCH /settings`): the diff threshold is a share (0.005
   * is 0.5%). `reviewOverdueNotify` is a person, sent as their ID.
   */
  settings?: Record<string, number | boolean | string | null>
  reviewOverdueNotify?: PersonKey
  /** Webhooks, all at the dev receiver, so every delivery succeeds. */
  webhooks?: readonly { url: string; events: readonly string[] }[]
  /** Rectangles (pixels) ignored when comparing the screenshots with this name. */
  ignore?: readonly { name: string; x: number; y: number; width: number; height: number }[]
}

/** The dev webhook receiver (webhook-receiver.ts). The dev server sets WEBHOOK_ALLOW_PRIVATE_ADDRESSES, so the address guard lets it through. */
const HOOKS = URLS.hooks

export const PROJECTS: readonly SeedProject[] = [
  {
    workspace: 'acme',
    name: 'Web app',
    slug: 'web-app',
    color: 'slate',
    icon: 'globe',
    members: ['owner', 'member', 'priya', 'sofia', 'liam', 'hannah'],
    rotation: ['owner', 'member', 'priya'],
    rules: [
      { kind: 'snapshot-name', pattern: 'settings/*', reviewers: ['priya'] },
      { kind: 'snapshot-name', pattern: 'dashboard/*', reviewers: ['owner', 'member'] },
    ],
    pinnedBy: ['owner', 'member'],
    settings: {
      diffThreshold: 0.005,
      retentionDays: 365,
      reviewTargetHours: 48,
      blockMergeOnChanges: true,
      autoApproveNoChanges: true,
      flakyAfterChanges: 3,
      requireRejectReason: true,
      closeReviewsOnNewerBuild: true,
      snoozeDefaultDays: 2,
    },
    reviewOverdueNotify: 'owner',
    webhooks: [
      { url: `${HOOKS}/hooks/circi`, events: ['build.completed', 'build.reviewed'] },
      { url: `${HOOKS}/hooks/audit`, events: ['build.completed'] },
    ],
    ignore: [
      { name: 'home', x: 700, y: 10, width: 200, height: 36 },
      { name: 'dashboard/overview', x: 600, y: 10, width: 300, height: 36 },
    ],
  },
  {
    workspace: 'acme',
    name: 'API',
    // `api` itself is a reserved slug (it would shadow the server's /api paths).
    slug: 'api-server',
    color: 'plum',
    icon: 'server',
    members: ['owner', 'priya', 'daniel', 'tomas'],
    rotation: ['daniel', 'tomas'],
    rules: [{ kind: 'build-name', pattern: 'docs*', reviewers: ['daniel'] }],
    pinnedBy: ['owner'],
    settings: {
      diffThreshold: 0.02,
      retentionDays: 180,
      reviewTargetHours: 24,
      blockMergeOnChanges: false,
      autoApproveNoChanges: false,
      flakyAfterChanges: 4,
      flakyBlocksMerge: true,
      reRequestOnNewerBuild: true,
      snoozeDefaultDays: 5,
    },
    reviewOverdueNotify: 'daniel',
    webhooks: [{ url: `${HOOKS}/hooks/chat-bridge`, events: ['build.reviewed'] }],
  },
  {
    workspace: 'acme',
    name: 'Storybook',
    slug: 'storybook',
    color: 'mauve',
    icon: 'book-open',
    members: ['owner', 'member', 'sofia', 'liam'],
    rotation: ['sofia', 'liam', 'member'],
    rules: [{ kind: 'snapshot-name', pattern: 'storybook/modal*', reviewers: ['sofia'] }],
    pinnedBy: ['member'],
    settings: {
      diffThreshold: 0,
      retentionDays: 120,
      blockMergeOnChanges: true,
      autoApproveNoChanges: true,
      flakyAfterChanges: 2,
      flakyBlocksMerge: false,
      requireRejectReason: false,
    },
  },
  {
    // The member isn't in this one, so it is hidden from them.
    workspace: 'acme',
    name: 'Design system',
    slug: 'design-system',
    color: 'moss',
    icon: 'palette',
    members: ['owner', 'sofia', 'amara'],
    rotation: ['amara', 'sofia'],
    rules: [{ kind: 'snapshot-name', pattern: 'tokens/*', reviewers: ['amara', 'sofia'] }],
    pinnedBy: ['owner'],
    settings: {
      diffThreshold: 0.005,
      retentionDays: 365,
      reviewTargetHours: 72,
      blockMergeOnChanges: true,
      autoApproveNoChanges: false,
      flakyAfterChanges: 5,
      closeReviewsOnNewerBuild: false,
    },
  },
  {
    workspace: 'acme',
    name: 'Marketing site',
    slug: 'marketing-site',
    color: 'olive',
    icon: 'megaphone',
    members: ['owner', 'hannah', 'amara', 'member'],
    rotation: ['hannah', 'amara'],
    rules: [{ kind: 'snapshot-name', pattern: 'blog/*', reviewers: ['hannah'] }],
    pinnedBy: ['owner', 'member'],
    settings: {
      diffThreshold: 0.02,
      retentionDays: 90,
      reviewTargetHours: 12,
      blockMergeOnChanges: false,
      autoApproveNoChanges: true,
      flakyAfterChanges: 3,
    },
    reviewOverdueNotify: 'hannah',
    webhooks: [{ url: `${HOOKS}/slack/marketing`, events: ['build.completed'] }],
  },
  {
    workspace: 'acme',
    name: 'Mobile web',
    slug: 'mobile-web',
    color: 'graphite',
    icon: 'smartphone',
    members: ['owner', 'member', 'tomas', 'liam'],
    rotation: ['tomas', 'liam', 'member'],
    rules: [],
    pinnedBy: [],
    settings: {
      diffThreshold: 0.005,
      retentionDays: 75,
      reviewTargetHours: 8,
      blockMergeOnChanges: true,
      autoApproveNoChanges: false,
      flakyAfterChanges: 3,
      flakyBlocksMerge: true,
    },
  },
  {
    // The big one: 150 screenshots a build, for the lists and the Reviews groups.
    workspace: 'acme',
    name: 'Component gallery',
    slug: 'component-gallery',
    color: 'moss',
    icon: 'layout-grid',
    members: ['owner', 'member', 'sofia', 'amara', 'priya'],
    rotation: ['amara', 'priya', 'owner'],
    rules: [{ kind: 'snapshot-name', pattern: 'gallery/00*', reviewers: ['sofia'] }],
    pinnedBy: ['owner'],
    settings: {
      diffThreshold: 0.005,
      retentionDays: 365,
      reviewTargetHours: 36,
      blockMergeOnChanges: true,
      autoApproveNoChanges: true,
      flakyAfterChanges: 3,
    },
  },
  {
    // Short retention and "approval required": old builds expire, no-change builds wait for a look.
    workspace: 'acme',
    name: 'Admin console',
    slug: 'admin-console',
    color: 'plum',
    icon: 'shield',
    members: ['owner', 'member', 'daniel', 'liam'],
    rotation: ['liam', 'daniel'],
    rules: [{ kind: 'snapshot-name', pattern: 'admin/billing*', reviewers: ['daniel'] }],
    pinnedBy: ['member'],
    settings: {
      diffThreshold: 0.02,
      retentionDays: 30,
      reviewTargetHours: 4,
      blockMergeOnChanges: true,
      autoApproveNoChanges: false,
      autoApproveDefaultBranch: false,
      flakyAfterChanges: 4,
    },
    reviewOverdueNotify: 'owner',
  },
  {
    workspace: 'northwind',
    name: 'Storefront',
    slug: 'storefront',
    color: 'olive',
    icon: 'shopping-cart',
    members: ['elena', 'kwame', 'priya', 'member'],
    rotation: ['kwame', 'priya'],
    rules: [{ kind: 'snapshot-name', pattern: 'checkout/*', reviewers: ['kwame'] }],
    pinnedBy: ['member'],
    settings: {
      diffThreshold: 0.02,
      retentionDays: 90,
      reviewTargetHours: 24,
      blockMergeOnChanges: true,
      autoApproveNoChanges: true,
    },
    webhooks: [{ url: `${HOOKS}/orders/notify`, events: ['build.reviewed'] }],
  },
  {
    workspace: 'pixel-studio',
    name: 'Portfolio',
    slug: 'portfolio',
    color: 'plum',
    icon: 'image',
    members: ['sofia', 'owner', 'tomas'],
    rotation: ['sofia'],
    rules: [],
    pinnedBy: ['owner'],
    settings: { diffThreshold: 0, retentionDays: 365, blockMergeOnChanges: false },
  },
  {
    // No builds: its workspace is the deleted one.
    workspace: 'old-labs',
    name: 'Prototype',
    slug: 'prototype',
    color: 'mauve',
    icon: 'layers',
    members: ['daniel', 'amara'],
    rotation: [],
    rules: [],
    pinnedBy: [],
  },
]

/** The accounts the seed creates (passwords are for this local database only). */
export const SEED = {
  password: 'circi-dev-password',
  owner: PEOPLE.owner,
  member: PEOPLE.member,
  workspace: { name: 'Acme', slug: 'acme' },
  project: { name: 'Web app', slug: 'web-app' },
  /** A second project only the owner is in: the member can't see it. */
  hiddenProject: { name: 'Design system', slug: 'design-system' },
}

/** The server's environment: a fixed secret so sessions survive restarts, mail to Mailpit. */
export function serverEnv(): Record<string, string> {
  return {
    DATABASE_URL: `postgres://circi:circi@127.0.0.1:${PORTS.postgres}/circi`,
    PUBLIC_URL: URLS.web,
    PORT: String(PORTS.server),
    HOST: '127.0.0.1',
    BETTER_AUTH_SECRET: 'circi-dev-secret-circi-dev-secret-0123456789',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    STORAGE_DRIVER: 'fs',
    STORAGE_PATH: join(STATE_DIR, 'files'),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(PORTS.smtp),
    SMTP_FROM: 'CirCI <ci@circi.dev>',
    WEBHOOK_ALLOW_PRIVATE_ADDRESSES: 'true',
    JOB_RETRY_BASE_SECONDS: '1',
    JOB_RETRY_MAX_SECONDS: '10',
  }
}
