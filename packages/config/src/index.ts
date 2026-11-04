import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
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
  publicUrl: URL
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

  if (issues.length > 0) throw new ConfigError(issues)

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    http: { host: e.HOST, port: e.PORT },
    publicUrl: new URL(e.PUBLIC_URL),
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    storage,
  }
}
