import type { InstanceAdmin } from '@circi/api'

export const account = (over: Partial<InstanceAdmin.Account> = {}): InstanceAdmin.Account => ({
  id: 'u1',
  email: 'dana@acme.dev',
  name: 'Dana Levi',
  image: null,
  instanceAdmin: false,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: '2026-09-12T10:00:00.000Z',
  lastSignInAt: null,
  workspaceCount: 1,
  ...over,
})

export const accountList = (
  accounts: InstanceAdmin.Account[],
  over: Partial<InstanceAdmin.AccountList> = {},
): InstanceAdmin.AccountList => ({
  accounts,
  total: accounts.length,
  page: 1,
  pageSize: 25,
  ...over,
})

export const workspace = (
  over: Partial<InstanceAdmin.Workspace> = {},
): InstanceAdmin.Workspace => ({
  id: 'w1',
  name: 'Acme',
  slug: 'acme',
  picture: null,
  memberCount: 6,
  projectCount: 3,
  storageBytes: 1_500_000,
  createdAt: '2026-09-12T10:00:00.000Z',
  deletedAt: null,
  daysLeft: null,
  ownerName: 'Michael Hazan',
  youAreMember: true,
  ...over,
})

const field = <T>(
  value: T,
  over: Partial<InstanceAdmin.Field<T>> = {},
): InstanceAdmin.Field<T> => ({
  value,
  source: 'default',
  env: null,
  ...over,
})

export const configFixture = (over: Partial<InstanceAdmin.Config> = {}): InstanceAdmin.Config => ({
  workspaceCreation: field<'admin' | 'anyone'>('admin'),
  signIn: { password: field(true), email: field(true), sso: field(true) },
  limits: {
    defaultProjectRetentionDays: field(90, { source: 'stored' }),
    gcGraceHours: field(24),
    uploadTimeoutMinutes: field(60),
    jobRetentionDays: field(14),
    staticSitesMaxMb: field(200),
    webhookTimeoutSeconds: field(10),
  },
  smtp: {
    source: 'stored',
    env: null,
    host: 'smtp.acme.io',
    port: 587,
    secure: false,
    user: 'mailer',
    from: 'CirCI <circi@acme.io>',
    passwordSaved: true,
  },
  slack: { source: 'none', env: null, clientId: '', secretSaved: false },
  sso: [
    {
      id: 'github',
      name: 'GitHub',
      clientId: 'gh-id',
      issuer: null,
      trustedForEmail: true,
      secretSaved: true,
      source: 'env',
      env: 'AUTH_GITHUB_*',
    },
  ],
  ...over,
})

export const settingsFixture = (
  over: Partial<InstanceAdmin.Settings> = {},
): InstanceAdmin.Settings => ({
  publicUrl: 'https://ci.acme.io',
  previousPublicHosts: [],
  config: configFixture(),
  githubApp: { source: 'none', appId: null },
  staticSites: { host: 'acme-sites.io' },
  storage: { driver: 'fs', bucket: null },
  webhooksAllowPrivateAddresses: false,
  ...over,
})
