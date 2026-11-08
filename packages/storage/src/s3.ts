import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { assertSha256Hex, assertValidKey, base64ToHex, hexToBase64 } from './keys.ts'
import {
  ChecksumMismatchError,
  type ObjectInfo,
  ObjectNotFoundError,
  type PresignedPut,
  type PresignPutOptions,
  type PutOptions,
  type PutResult,
  type StorageDriver,
} from './types.ts'

export interface S3StorageOptions {
  bucket: string
  region: string
  /** For R2, B2, MinIO, Hetzner… Omit for AWS S3. */
  endpoint?: string
  forcePathStyle?: boolean
  /** Omit to use the default AWS credential chain (env, IAM role, …). */
  credentials?: { accessKeyId: string; secretAccessKey: string }
  /** Optional prefix inside the bucket, e.g. "circi/". */
  prefix?: string
  /** Give up connecting after this many ms. Default 10 s. */
  connectTimeoutMs?: number
  /** Give up when a request's socket is silent for this many ms. Default 60 s. */
  requestTimeoutMs?: number
}

export const DEFAULT_S3_CONNECT_TIMEOUT_MS = 10_000
export const DEFAULT_S3_REQUEST_TIMEOUT_MS = 60_000

const DEFAULT_PRESIGN_TTL = 15 * 60

export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const
  readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(options: S3StorageOptions, client?: S3Client) {
    this.bucket = options.bucket
    this.prefix = options.prefix ?? ''
    this.client =
      client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        forcePathStyle: options.forcePathStyle ?? false,
        // Without these a silently dropped connection hangs a request (or a worker job) forever.
        // The SDK turns this object into a NodeHttpHandler. socketTimeout is the idle time of the
        // request's socket, so a big download that keeps flowing is never cut off (the handler's
        // requestTimeout is a total time that only logs a warning unless throwOnRequestTimeout).
        requestHandler: {
          connectionTimeout: options.connectTimeoutMs ?? DEFAULT_S3_CONNECT_TIMEOUT_MS,
          socketTimeout: options.requestTimeoutMs ?? DEFAULT_S3_REQUEST_TIMEOUT_MS,
        },
        ...(options.credentials ? { credentials: options.credentials } : {}),
        // We always send an explicit SHA-256 checksum. The SDK's default (WHEN_SUPPORTED) would
        // also add a CRC32 of the *empty* body to presigned URLs, which makes real uploads fail.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      })
  }

  private objectKey(key: string): string {
    assertValidKey(key)
    return this.prefix + key
  }

  async put(
    key: string,
    body: Readable | Uint8Array,
    options: PutOptions = {},
  ): Promise<PutResult> {
    // Buffer the body: we must know the sha256 before sending so S3 verifies it server-side.
    // Uploads through this path are screenshots and site files, which are small.
    const bytes = body instanceof Uint8Array ? Buffer.from(body) : await readAll(body)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (options.expectedSha256) {
      assertSha256Hex(options.expectedSha256)
      if (sha256 !== options.expectedSha256) {
        throw new ChecksumMismatchError(options.expectedSha256, sha256)
      }
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: bytes,
        ContentLength: bytes.length,
        ChecksumSHA256: hexToBase64(sha256),
        ...(options.contentType ? { ContentType: options.contentType } : {}),
      }),
    )
    return { size: bytes.length, sha256 }
  }

  async get(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )
      if (!res.Body) throw new ObjectNotFoundError(key)
      // In Node the SDK returns an IncomingMessage, which is a Readable.
      if (!(res.Body instanceof Readable)) throw new Error('S3 returned a non-stream body')
      return res.Body
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError(key)
      throw err
    }
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
          ChecksumMode: 'ENABLED',
        }),
      )
      return {
        size: res.ContentLength ?? 0,
        ...(res.ContentType ? { contentType: res.ContentType } : {}),
        ...(res.ChecksumSHA256 && !res.ChecksumSHA256.includes('-')
          ? { sha256: base64ToHex(res.ChecksumSHA256) }
          : {}),
      }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    )
  }

  /**
   * Presigned PUT that only accepts the exact bytes announced (PLAN §8 "verify before dedup"):
   * the SHA-256 checksum, length and content type are signed headers, so S3 rejects anything else.
   */
  async presignPut(key: string, options: PresignPutOptions): Promise<PresignedPut> {
    assertSha256Hex(options.sha256)
    const checksum = hexToBase64(options.sha256)
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      ChecksumSHA256: checksum,
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? DEFAULT_PRESIGN_TTL,
      signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    })
    return {
      url,
      method: 'PUT',
      headers: {
        'content-type': options.contentType,
        'content-length': String(options.contentLength),
        'x-amz-checksum-sha256': checksum,
      },
    }
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch (err) {
      throw new Error(describeS3Failure(err, this.bucket), { cause: err })
    }
  }
}

/** A sentence the operator can act on, instead of the SDK's "UnknownError". */
export function describeS3Failure(err: unknown, bucket: string): string {
  const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined
  const code = err instanceof Error && 'code' in err ? err.code : undefined
  if (status === 404) {
    return `S3 bucket "${bucket}" does not exist (or S3_ENDPOINT points at the wrong service). Create it, or fix S3_BUCKET / S3_REGION.`
  }
  if (status === 401 || status === 403) {
    return `S3 refused access to bucket "${bucket}" (HTTP ${status}). Check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and that they may read, write and delete in this bucket.`
  }
  if (isTimeout(err)) {
    return `S3 did not answer in time for bucket "${bucket}" (timed out: ${err instanceof Error ? err.message : String(err)}). Check S3_ENDPOINT, the network and firewalls, or raise S3_CONNECT_TIMEOUT_SECONDS / S3_REQUEST_TIMEOUT_SECONDS.`
  }
  if (status === undefined || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    const reason = err instanceof Error ? err.message : String(err)
    return `Cannot reach S3 for bucket "${bucket}": ${reason}. Check S3_ENDPOINT and the network.`
  }
  return `S3 bucket "${bucket}" is not usable (HTTP ${status}): ${err instanceof Error ? err.message : String(err)}`
}

function isTimeout(err: unknown): boolean {
  let e: unknown = err
  for (let i = 0; i < 4 && e instanceof Error; i++) {
    if (e.name === 'TimeoutError' || /timed out|timeout/i.test(e.message)) return true
    if ('code' in e && e.code === 'ETIMEDOUT') return true
    e = e.cause
  }
  return false
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey || err instanceof NotFound) return true
  return err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
