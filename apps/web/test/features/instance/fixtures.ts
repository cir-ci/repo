import type { InstanceAdmin } from '@circi/api'

export const account = (over: Partial<InstanceAdmin.Account> = {}): InstanceAdmin.Account => ({
  id: 'u1',
  email: 'dana@acme.dev',
  name: 'Dana Levi',
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
  memberCount: 6,
  teamCount: 3,
  storageBytes: 1_500_000,
  createdAt: '2026-09-12T10:00:00.000Z',
  ...over,
})

export const settingsFixture = (
  over: Partial<InstanceAdmin.Settings> = {},
): InstanceAdmin.Settings => ({
  publicUrl: 'https://ci.acme.io',
  previousPublicHosts: [],
  mail: {
    configured: true,
    from: 'CirCI <circi@acme.io>',
    host: 'smtp.acme.io',
    port: 587,
    secure: false,
    authenticated: true,
  },
  auth: { password: true, email: true, sso: [{ id: 'github', name: 'GitHub' }] },
  workspaceCreation: 'admin',
  retention: { defaultTeamRetentionDays: 90, gcGraceHours: 24, uploadTimeoutMinutes: 60 },
  githubApp: { source: 'none', appId: null },
  staticSites: { host: 'acme-sites.io', maxMb: 200 },
  storage: { driver: 'fs', bucket: null },
  webhooksAllowPrivateAddresses: false,
  ...over,
})
