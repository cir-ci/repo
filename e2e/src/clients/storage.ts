import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import sharp from 'sharp'

import type { Stack } from '#stack/stack.ts'

export const sha256Hex = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

/** A PNG that does not compress: roughly `side * side * 3` bytes. Deterministic per `seed`. */
export async function noisePng(side: number, seed = 1): Promise<Buffer> {
  const raw = Buffer.alloc(side * side * 3)
  let x = seed >>> 0 || 1
  for (let i = 0; i < raw.length; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    raw[i] = x & 255
  }
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toBuffer()
}

export interface FakeS3 {
  /** The endpoint as the containers reach it. */
  endpoint: string
  requests: string[]
  close(): Promise<void>
}

/**
 * A host-side "S3" that answers every request with the given error status and an S3-style XML
 * body: what a provider that refuses the credentials (403) or does not know the bucket (404)
 * looks like. LocalStack accepts any credentials, so this is the only way to get a 403.
 */
export async function startFakeS3(status: number, code = 'AccessDenied'): Promise<FakeS3> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    res.writeHead(status, { 'content-type': 'application/xml' })
    res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`)
  })
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    endpoint: `http://host.docker.internal:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  }
}

export interface FileRow {
  sha256: string
  storageKey: string
  kind: string
  size: number
  markedAt: string | null
}

/** The verified rows of the `files` table, straight from Postgres. */
export async function fileRows(stack: Stack, where = "status = 'verified'"): Promise<FileRow[]> {
  const rows = await stack.sql(
    `select sha256, storage_key, kind, coalesce(size, 0), coalesce(gc_marked_at::text, '') from files where ${where} order by sha256`,
  )
  return rows.map(([sha256 = '', storageKey = '', kind = '', size = '0', marked = '']) => ({
    sha256,
    storageKey,
    kind,
    size: Number(size),
    markedAt: marked === '' ? null : marked,
  }))
}

/** The JSON a `circi admin` command printed (logs may come before it). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller states the shape
export function parseJsonOutput<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return JSON.parse(text.slice(start, end + 1)) as T
}
