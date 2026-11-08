import { createHmac } from 'node:crypto'

/**
 * The secret token on this instance's GitLab webhooks, derived from the instance secret so
 * nothing extra is configured or stored. GitLab webhooks are created by hand per project or
 * group, so the GitLab page shows this value to owners and admins to paste as the "Secret token".
 */
export const gitlabWebhookSecret = (authSecret: string): string =>
  createHmac('sha256', authSecret).update('circi:gitlab-webhook').digest('hex')
