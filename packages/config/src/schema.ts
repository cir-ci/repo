import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  PREVIOUS_PUBLIC_URLS: z.string().default(''),
  TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
  BETTER_AUTH_SECRET: z
    .string({ error: 'is required (generate one with: openssl rand -base64 32)' })
    .min(32, 'must be at least 32 characters (generate one with: openssl rand -base64 32)'),
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
  S3_CONNECT_TIMEOUT_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(1).max(600).default(10),
  ),
  S3_REQUEST_TIMEOUT_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(1).max(3600).default(60),
  ),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.preprocess(emptyToUndefined, bool.optional()),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_EMAIL_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  WEBHOOK_ALLOW_PRIVATE_ADDRESSES: z.preprocess(emptyToUndefined, bool.optional()),
  GITHUB_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_APP_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_APP_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_API_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SLACK_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  SLACK_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  SLACK_API_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  STATIC_SITES_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  STATIC_SITES_MAX_MB: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(5000).default(200),
  ),
  GC_GRACE_HOURS: z.preprocess(emptyToUndefined, z.coerce.number().min(0).default(24)),
  UPLOAD_TIMEOUT_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(60),
  ),
  AUTH_PASSWORD_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  AUTH_SSO_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  AUTH_GITHUB_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GITHUB_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GITLAB_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GITLAB_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  /** A self-managed GitLab's address; default gitlab.com. */
  AUTH_GITLAB_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_ISSUER: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_TRUSTED_FOR_EMAIL: z.preprocess(emptyToUndefined, bool.optional()),
  WORKSPACE_CREATION: z.preprocess(emptyToUndefined, z.enum(['admin', 'anyone']).default('admin')),
})
