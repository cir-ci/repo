import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from '../src/index.ts'

const base = { DATABASE_URL: 'postgres://localhost/circi' }

describe('loadConfig', () => {
  it('applies defaults (local-disk storage)', () => {
    const c = loadConfig(base)
    expect(c.storage).toEqual({ driver: 'fs', path: '/var/lib/circi/files' })
    expect(c.http).toEqual({ host: '0.0.0.0', port: 3000 })
    expect(c.publicUrl.href).toBe('http://localhost:3000/')
    expect(c.env).toBe('production')
  })

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  it('requires S3_BUCKET for the s3 driver', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(
      expect.objectContaining({ issues: [expect.stringContaining('S3_BUCKET')] }),
    )
  })

  it('rejects half-set S3 credentials', () => {
    expect(() =>
      loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'x' }),
    ).toThrow(/set both/)
  })

  it('uses path-style addressing by default when an endpoint is set (MinIO, R2)', () => {
    const c = loadConfig({
      ...base,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'circi',
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
    })
    expect(c.storage).toMatchObject({
      driver: 's3',
      bucket: 'circi',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    })
  })

  it('omits credentials so the AWS chain (IAM role) is used', () => {
    const c = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: '' })
    expect(c.storage).not.toHaveProperty('credentials')
    expect(c.storage).toMatchObject({ forcePathStyle: false })
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(ConfigError)
  })
})
