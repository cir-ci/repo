import type { Readable } from 'node:stream'

export interface PutOptions {
  contentType?: string
  /** Hex sha256 the bytes must match. On mismatch nothing is stored and ChecksumMismatchError is thrown. */
  expectedSha256?: string
  /** Known body length; lets S3 stream without buffering. */
  contentLength?: number
}

export interface PutResult {
  size: number
  sha256: string
}

export interface ObjectInfo {
  size: number
  contentType?: string
  /** Hex sha256 when the backend stores it (S3 with checksums); undefined for FS. */
  sha256?: string
}

export interface PresignPutOptions {
  /** Hex sha256 of the exact bytes the client will upload. Storage rejects anything else. */
  sha256: string
  contentLength: number
  contentType: string
  expiresInSeconds?: number
}

export interface PresignedPut {
  url: string
  method: 'PUT'
  /** Headers the client must send unchanged; they are part of the signature. */
  headers: Record<string, string>
}

export interface StorageDriver {
  readonly kind: 'fs' | 's3'
  put(key: string, body: Readable | Uint8Array, options?: PutOptions): Promise<PutResult>
  get(key: string): Promise<Readable>
  head(key: string): Promise<ObjectInfo | null>
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>
  /** Direct-to-storage upload URL. Only S3 supports it; FS uploads stream through the API. */
  presignPut?(key: string, options: PresignPutOptions): Promise<PresignedPut>
  healthCheck(): Promise<void>
}

export class ObjectNotFoundError extends Error {
  readonly key: string
  constructor(key: string) {
    super(`Object not found: ${key}`)
    this.name = 'ObjectNotFoundError'
    this.key = key
  }
}

export class ChecksumMismatchError extends Error {
  readonly expected: string
  readonly actual: string
  constructor(expected: string, actual: string) {
    super(`sha256 mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ChecksumMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

export class InvalidKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key "${key}": ${reason}`)
    this.name = 'InvalidKeyError'
  }
}
