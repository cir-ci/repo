/** `@circi/integrations/github`: the GitHub App client and the manifest flow that creates the App. */
export {
  GithubApiError,
  GithubApp,
  githubWebhookVerifier,
  GithubInstallationRevokedError,
  type GithubAppOptions,
  verifyGithubSignature,
} from './client.ts'
export {
  buildGithubManifest,
  convertGithubManifestCode,
  defaultGithubAppName,
  GITHUB_APP_EVENTS,
  GITHUB_APP_NAME_MAX,
  GITHUB_APP_PERMISSIONS,
  type GithubAppCredentials,
  GithubManifestError,
  githubManifestPostUrl,
  githubWebBase,
  type GithubManifest,
} from './manifest.ts'
