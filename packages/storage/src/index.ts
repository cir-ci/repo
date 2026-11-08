import { FsStorage } from './fs.ts'
import { S3Storage } from './s3.ts'
import type { StorageDriver } from './types.ts'

export { FsStorage } from './fs.ts'
export { assertValidKey, base64ToHex, contentKey, hexToBase64 } from './keys.ts'
export { S3Storage } from './s3.ts'
export * from './types.ts'

export namespace createStorage {
  export type Options =
    | ({ driver: 'fs' } & FsStorage.Options)
    | ({ driver: 's3' } & S3Storage.Options)
}

export function createStorage(options: createStorage.Options): StorageDriver {
  return options.driver === 'fs' ? new FsStorage(options) : new S3Storage(options)
}
