import { type Auth, createAuth, createSmtpMailer, type Mailer } from '@circi/auth'
import { type Config, loadConfig } from '@circi/config'
import { createDb, type DbHandle } from '@circi/db'
import {
  BitbucketCloud,
  GithubApp,
  GitlabProvider,
  type ProviderRegistry,
  providerRegistry,
} from '@circi/providers'
import { createStorage, type StorageDriver } from '@circi/storage'
import { type Logger, pino } from 'pino'

import { bitbucketWebhookSecret } from '#http/lib/bitbucket-secret.ts'
import { gitlabWebhookSecret } from '#http/lib/gitlab-secret.ts'

export interface Runtime {
  config: Config
  logger: Logger
  db: DbHandle
  auth: Auth
  /** The GitHub App; absent when none is configured. */
  github?: GithubApp
  /** GitLab: needs no instance setup (each connection brings its address and token). */
  gitlab: GitlabProvider
  /** Git host adapters by `provider_connections.kind`; add a host's adapter where `providers` is built. */
  providers: ProviderRegistry
  /** Bitbucket Cloud: always available, each connection brings its own token. */
  bitbucket: BitbucketCloud
  /** Sends mail; absent without SMTP. */
  mailer?: Mailer
  storage: StorageDriver
  close(): Promise<void>
}

export function createLogger(config: Pick<Config, 'logLevel' | 'env'>): Logger {
  return pino({
    level: config.logLevel,
    base: { service: 'circi' },
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
  })
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const config = loadConfig(env)
  const logger = createLogger(config)
  const db = createDb({ url: config.database.url, poolMax: config.database.poolMax })
  const mailer = config.smtp ? createSmtpMailer(config.smtp) : undefined
  const auth = createAuth({
    db: db.db,
    secret: config.authSecret,
    baseURL: config.publicUrl.origin,
    ...(mailer ? { mailer } : {}),
    passwordLogin: config.passwordLogin,
    sso: config.sso,
    onMailError: (err) => logger.error({ err }, 'could not send a mail'),
  })
  const github = config.github
    ? new GithubApp({
        apiUrl: config.github.apiUrl,
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        webhookSecret: config.github.webhookSecret,
      })
    : undefined
  const gitlab = new GitlabProvider({ webhookSecret: gitlabWebhookSecret(config.authSecret) })
  const bitbucket = new BitbucketCloud({
    webhookSecret: bitbucketWebhookSecret(config.authSecret),
  })
  const storage = createStorage(config.storage)
  return {
    config,
    logger,
    db,
    auth,
    ...(mailer ? { mailer } : {}),
    ...(github ? { github } : {}),
    gitlab,
    providers: providerRegistry({ github, gitlab, bitbucket }),
    bitbucket,
    storage,
    async close() {
      await db.close()
    },
  }
}
