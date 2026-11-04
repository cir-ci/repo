import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
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
  /** Optional prefix inside the bucket, e.g. "zopheros/". */
  prefix?: string
}

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
      return res.Body as Readable
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
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }
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
