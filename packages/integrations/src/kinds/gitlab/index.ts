/** `@circi/integrations/gitlab`: the GitLab client. */
export {
  GitlabApiError,
  type GitlabCredentials,
  type GitlabOptions,
  GitlabProvider,
  gitlabCredentials,
  gitlabExternalId,
  gitlabHostOf,
  gitlabWebhookVerifier,
  normalizeGitlabBaseUrl,
  parseGitlabCredentials,
  verifyGitlabToken,
} from './client.ts'
