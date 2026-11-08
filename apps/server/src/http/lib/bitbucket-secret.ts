import { createHmac } from 'node:crypto'

/**
 * The secret on this instance's Bitbucket webhooks, derived from the instance secret so nothing
 * extra is configured or stored: Bitbucket Cloud has no app to hold one, so each workspace's
 * webhook is created by hand and the Bitbucket page shows this value to owners and admins.
 */
export const bitbucketWebhookSecret = (authSecret: string): string =>
  createHmac('sha256', authSecret).update('circi:bitbucket-webhook').digest('hex')
