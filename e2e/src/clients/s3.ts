import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export const S3_BUCKET = 'circi-e2e'
export const S3_ACCESS_KEY = 'e2e-access'
export const S3_SECRET_KEY = 'e2e-secret'

export interface S3Object {
  key: string
  size: number
  lastModified: Date | undefined
}

/**
 * The LocalStack bucket CirCI stores files in, seen from the test process (the host), through the
 * same client library the server uses.
 */
export class S3Bucket {
  readonly bucket = S3_BUCKET
  /** Where the host reaches LocalStack. */
  readonly endpoint: string
  readonly client: S3Client

  constructor(port: number) {
    this.endpoint = `http://127.0.0.1:${port}`
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    })
  }

  /** Creates the bucket when it does not exist yet (the harness calls this before CirCI starts). */
  async ensure(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }))
    }
  }

  async list(prefix = ''): Promise<S3Object[]> {
    const out: S3Object[] = []
    let token: string | undefined
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      )
      for (const o of page.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified })
      }
      token = page.NextContinuationToken
    } while (token)
    return out
  }

  async keys(prefix = ''): Promise<string[]> {
    return (await this.list(prefix)).map((o) => o.key)
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) throw new Error(`${key} has no body`)
    return Buffer.from(await res.Body.transformToByteArray())
  }

  async put(key: string, body: Buffer | string, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    )
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    return (await this.keys(key)).includes(key)
  }

  destroy(): void {
    this.client.destroy()
  }
}

/** The server variables that point CirCI at the stack's LocalStack bucket. */
export function s3Env(stack: { ports: { s3: number | undefined } }): Record<string, string> {
  if (!stack.ports.s3)
    throw new Error('the stack has no LocalStack (use storage: "s3" or localstack: true)')
  return {
    STORAGE_DRIVER: 's3',
    S3_BUCKET,
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: `http://host.docker.internal:${stack.ports.s3}`,
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
    S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
  }
}
