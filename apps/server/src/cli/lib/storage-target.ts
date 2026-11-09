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
    return createStorage({
      driver: 's3',
      bucket: opts.bucket,
      region: opts.region ?? 'us-east-1',
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    })
  }
  return undefined
}
