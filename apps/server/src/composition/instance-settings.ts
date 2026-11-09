import type { InstanceAdmin } from '@circi/api'
import { callbackUrl } from '@circi/auth'
import { DEFAULT_TEAM_RETENTION_DAYS } from '@circi/core'

import type { Deps } from '#http/lib/deps.ts'

import { githubAppSource } from './github-app.ts'

type Instance = Deps.Instance
type Scope = Pick<Deps.Dashboard, 'githubApp' | 'integrations'>

/** The effective settings from the environment; secrets (SMTP login, client secrets, keys) never appear. */
export function describeSettings(instance: Instance, scope: Scope): InstanceAdmin.Settings {
  const { config } = instance
  const { smtp, staticSites } = config
  return {
    publicUrl: config.publicUrl.origin,
    previousPublicHosts: config.previousPublicHosts,
    mail: {
      configured: smtp !== undefined,
      from: smtp?.from ?? null,
      host: smtp?.host ?? null,
      port: smtp?.port ?? null,
      secure: smtp?.secure ?? null,
      authenticated: smtp?.auth !== undefined,
    },
    auth: {
      password: config.passwordLogin,
      email: config.emailLogin,
      sso: config.sso.map((p) => ({ id: p.id, name: p.name })),
    },
    workspaceCreation: config.workspaceCreation,
    retention: {
      defaultTeamRetentionDays: DEFAULT_TEAM_RETENTION_DAYS,
      gcGraceHours: config.gcGraceHours,
      uploadTimeoutMinutes: config.uploadTimeoutMinutes,
    },
    githubApp: {
      source: githubAppSource(scope),
      appId: scope.integrations?.config.github?.appId ?? null,
    },
    staticSites: staticSites
      ? { host: staticSites.host, maxMb: Math.round(staticSites.maxBytes / (1024 * 1024)) }
      : null,
    storage:
      config.storage.driver === 's3'
        ? { driver: 's3', bucket: config.storage.bucket }
        : { driver: 'fs', bucket: null },
    webhooksAllowPrivateAddresses: config.webhookAllowPrivate,
  }
}

/**
 * What to change when `PUBLIC_URL` changes, computed from the current configuration: only the
 * parts this instance uses are listed. The same facts as `publicUrlChecklist`, with the values.
 */
export function addressChecklist(
  instance: Instance,
  scope: Scope,
): Omit<InstanceAdmin.AddressChecklist, 'dismissed' | 'previousHosts'> {
  const { config } = instance
  const origin = config.publicUrl.origin
  const steps: InstanceAdmin.AddressStep[] = [
    {
      id: 'dns',
      title: 'Point DNS and TLS at CirCI, and keep the old address redirecting',
      detail:
        'Set PUBLIC_URL to the new address. Keep DNS and TLS for the old one and list it in PREVIOUS_PUBLIC_URLS, so old links in pull requests and emails redirect.',
      values: [
        `PUBLIC_URL=${origin}`,
        `PREVIOUS_PUBLIC_URLS=${config.previousPublicHosts.join(',') || '<the old address>'}`,
      ],
    },
    {
      id: 'sessions',
      title: 'People sign in again once',
      detail: 'Dashboard cookies belong to one host, so every session ends at the move.',
      values: [],
    },
    {
      id: 'sign-in-redirects',
      title: 'Single sign-on: change every redirect URI',
      detail:
        'In each identity provider, change the redirect URI to the new address. A workspace’s own provider (Workspace › Sign-in and domains) redirects to /api/auth/sso/callback/<provider id>.',
      values: [
        ...config.sso.map((p) => callbackUrl(origin, p)),
        `${origin}/api/auth/sso/callback/<provider id>`,
      ],
    },
  ]
  if (githubAppSource(scope) !== 'none') {
    steps.push({
      id: 'github-app',
      title: 'GitHub App: update its URLs',
      detail:
        'Update the App’s callback URL and webhook URL on GitHub (Settings › Developer settings › GitHub Apps), and the webhook of any repository that still posts to the old address.',
      values: [origin, `${origin}/webhooks/github`],
    })
  }
  steps.push({
    id: 'git-webhooks',
    title: 'GitLab and Bitbucket: update their webhooks',
    detail: 'Webhooks that CirCI registered keep the old address until they are registered again.',
    values: [`${origin}/webhooks/gitlab`, `${origin}/webhooks/bitbucket`],
  })
  steps.push({
    id: 'integration-redirects',
    title: 'Slack, Linear, Jira and other connected apps: change their redirect URIs',
    detail: 'Each app’s OAuth redirect URI is on the new address.',
    values: [
      ...(config.slack ? [`${origin}/api/integrations/slack/callback`] : []),
      `${origin}/api/integrations/<integration>/callback`,
    ],
  })
  steps.push({
    id: 'ci',
    title: 'CI: point `circi upload` at the new address',
    detail: 'Set CIRCI_API_URL (or --api-url) in every CI job.',
    values: [`CIRCI_API_URL=${origin}`],
  })
  if (config.staticSites) {
    steps.push({
      id: 'sites',
      title: 'Hosted sites: nothing to change, but check the ports and scheme',
      detail: `Sites live under ${config.staticSites.host} and take the dashboard’s scheme and port.`,
      values: [],
    })
  }
  return { publicUrl: origin, steps }
}
