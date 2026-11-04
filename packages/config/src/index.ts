import { z } from 'zod'

import { isLocalAddress, type PublicAddress, parsePublicAddress } from './public-url.ts'

export { isLocalAddress, type PublicAddress, parsePublicAddress } from './public-url.ts'

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  PREVIOUS_PUBLIC_URLS: z.string().default(''),
  DATABASE_URL: z.string({ error: 'is required' }).min(1, 'is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_PATH: z.string().default('/var/lib/circi/files'),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_FORCE_PATH_STYLE: z.preprocess(emptyToUndefined, bool.optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
})

export type StorageConfig =
  | { driver: 'fs'; path: string }
  | {
      driver: 's3'
      bucket: string
      region: string
      endpoint?: string
      forcePathStyle: boolean
      credentials?: { accessKeyId: string; secretAccessKey: string }
    }

export interface Config {
  env: 'development' | 'production' | 'test'
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  http: { host: string; port: number }
  /** The dashboard address (`PUBLIC_URL`). Any host you own; see PLAN §7.9. */
  publicUrl: PublicAddress
  /**
   * Hosts the dashboard used to live on (`PREVIOUS_PUBLIC_URLS`). Requests to them are
   * redirected to `publicUrl`, so old links in PR comments and emails keep working.
   */
  previousPublicHosts: string[]
  /** Settings that work but are probably a mistake; logged at startup. */
  warnings: string[]
  database: { url: string; poolMax: number }
  storage: StorageConfig
}

export class ConfigError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  const e = parsed.data
  const issues: string[] = []
  const warnings: string[] = []

  const publicUrl = parsePublicAddress(e.PUBLIC_URL, 'PUBLIC_URL')
  if (typeof publicUrl === 'string') issues.push(publicUrl)
  else if (publicUrl.protocol === 'http:' && !isLocalAddress(publicUrl)) {
    warnings.push(
      `PUBLIC_URL uses plain http on ${publicUrl.host}. Logins need https outside local development; put a TLS proxy such as Caddy in front and use https://${publicUrl.host}.`,
    )
  }

  const previousPublicHosts: string[] = []
  for (const raw of e.PREVIOUS_PUBLIC_URLS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const prev = parsePublicAddress(raw, 'PREVIOUS_PUBLIC_URLS')
    if (typeof prev === 'string') issues.push(prev)
    else if (typeof publicUrl !== 'string' && prev.host === publicUrl.host) {
      issues.push(`PREVIOUS_PUBLIC_URLS: ${prev.host} is the current PUBLIC_URL host`)
    } else if (!previousPublicHosts.includes(prev.host)) previousPublicHosts.push(prev.host)
  }

  let storage: StorageConfig
  if (e.STORAGE_DRIVER === 's3') {
    if (!e.S3_BUCKET) issues.push('S3_BUCKET: required when STORAGE_DRIVER=s3')
    if (Boolean(e.S3_ACCESS_KEY_ID) !== Boolean(e.S3_SECRET_ACCESS_KEY)) {
      issues.push(
        'S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY: set both, or neither to use the default AWS credential chain (e.g. an IAM role)',
      )
    }
    storage = {
      driver: 's3',
      bucket: e.S3_BUCKET ?? '',
      region: e.S3_REGION,
      ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT } : {}),
      forcePathStyle: e.S3_FORCE_PATH_STYLE ?? Boolean(e.S3_ENDPOINT),
      ...(e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: e.S3_ACCESS_KEY_ID,
              secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    }
  } else {
    storage = { driver: 'fs', path: e.STORAGE_PATH }
  }

  if (issues.length > 0 || typeof publicUrl === 'string') throw new ConfigError(issues)

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    http: { host: e.HOST, port: e.PORT },
    publicUrl,
    previousPublicHosts,
    warnings,
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    storage,
  }
}
