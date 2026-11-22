import { envSchema } from './schema.ts'

/**
 * What the server and the deploys (deploy/terraform, deploy/docker-compose.yml) need to know about
 * the settings beyond their types: which are secret, which the image fixes and which go together.
 * The loader checks the groups; packages/config/test/deploy-settings.test.ts holds the deploys to
 * all three lists, so a change here reaches them or fails there.
 */
export type SettingName = keyof typeof envSchema.shape

/** Every setting the server reads, by name. */
export const SETTING_NAMES: readonly SettingName[] = envSchema.keyof().options

/** Secrets: the deploys keep them out of plan output and pass them as files (`<NAME>_FILE`). */
export const SECRET_SETTINGS = [
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'SLACK_CLIENT_SECRET',
  'VAPID_PRIVATE_KEY',
  'AUTH_GITHUB_CLIENT_SECRET',
  'AUTH_GOOGLE_CLIENT_SECRET',
  'AUTH_GITLAB_CLIENT_SECRET',
  'AUTH_OIDC_CLIENT_SECRET',
] as const satisfies readonly SettingName[]

/**
 * Set by the image (deploy/Dockerfile's `ENV`) for its own layout: the port the proxy and health
 * check use, the volume, the bundle's paths. Not an input of the deploys.
 */
export const IMAGE_SETTINGS = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'STORAGE_PATH',
  'CIRCI_MIGRATIONS',
  'CIRCI_WEB_DIST',
] as const satisfies readonly SettingName[]

/** Settings that go together: all set, or none. */
export const SETTING_GROUPS = {
  smtpLogin: ['SMTP_USER', 'SMTP_PASSWORD'],
  s3Keys: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  githubApp: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET'],
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  vapid: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  authGithub: ['AUTH_GITHUB_CLIENT_ID', 'AUTH_GITHUB_CLIENT_SECRET'],
  authGoogle: ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET'],
  authGitlab: ['AUTH_GITLAB_CLIENT_ID', 'AUTH_GITLAB_CLIENT_SECRET'],
  authOidc: ['AUTH_OIDC_ISSUER', 'AUTH_OIDC_CLIENT_ID', 'AUTH_OIDC_CLIENT_SECRET'],
} as const satisfies Record<
  string,
  readonly [SettingName, SettingName] | readonly [SettingName, SettingName, SettingName]
>

export type SettingGroup = (typeof SETTING_GROUPS)[keyof typeof SETTING_GROUPS]

/** Whether all, none or only some of a group's settings are set (an empty value is unset). */
export function groupState(
  env: Readonly<Partial<Record<SettingName, unknown>>>,
  group: SettingGroup,
): 'all' | 'none' | 'some' {
  const set = group.filter((name) => Boolean(env[name])).length
  return set === 0 ? 'none' : set === group.length ? 'all' : 'some'
}

/** The loader's message for a group that is only partly set, e.g. "A / B: set both, or neither". */
export function partlySet(group: SettingGroup, why = ''): string {
  const rule = group.length === 2 ? 'set both, or neither' : 'set all three'
  return `${group.join(' / ')}: ${rule}${why}`
}
