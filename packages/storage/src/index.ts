import { FsStorage, type FsStorageOptions } from './fs.ts'
import { S3Storage, type S3StorageOptions } from './s3.ts'
import type { StorageDriver } from './types.ts'

export { FsStorage, type FsStorageOptions } from './fs.ts'
export { assertValidKey, base64ToHex, contentKey, hexToBase64 } from './keys.ts'
export { S3Storage, type S3StorageOptions } from './s3.ts'
export * from './types.ts'

export type StorageOptions =
  | ({ driver: 'fs' } & FsStorageOptions)
  | ({ driver: 's3' } & S3StorageOptions)

export function createStorage(options: StorageOptions): StorageDriver {
  return options.driver === 'fs' ? new FsStorage(options) : new S3Storage(options)
}
