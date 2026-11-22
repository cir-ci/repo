import { resolveSettingFiles } from '@circi/config'
import { createStorage } from '@circi/storage'

export interface StorageTargetOptions {
  to: string
  path?: string
  bucket?: string
  region?: string
  endpoint?: string
  forcePathStyle?: boolean
}

/** The storage `storage migrate` copies to, or undefined when the options don't describe one. */
export function storageTarget(opts: StorageTargetOptions) {
  if (opts.to === 'fs') {
    return opts.path ? createStorage({ driver: 'fs', path: opts.path }) : undefined
  }
  if (opts.to === 's3' && opts.bucket) {
    // The target's keys come from the same settings as the server's (S3_*, or S3_*_FILE).
    const env = resolveSettingFiles()
    return createStorage({
      driver: 's3',
      bucket: opts.bucket,
      region: opts.region ?? 'us-east-1',
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    })
  }
  return undefined
}
