import { randomUUID } from 'node:crypto'
import { createServer as createNetServer, type Socket } from 'node:net'
import { text } from 'node:stream/consumers'

import { sha256 } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ChecksumMismatchError, hexToBase64, S3Storage } from '#src/index.ts'

describe('S3Storage.presignPut (offline)', () => {
  const storage = new S3Storage({
    bucket: 'circi',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  })

  it('signs the checksum, length and content type as headers', async () => {
    const hash = sha256('png-bytes')
    const presigned = await storage.presignPut('aa/bb/key', {
      sha256: hash,
      contentLength: 9,
      contentType: 'image/png',
    })
    const url = new URL(presigned.url)
    expect(url.pathname).toBe('/circi/aa/bb/key')
    const signed = url.searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? []
    expect(signed).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'x-amz-checksum-sha256']),
    )
    // The checksum must be a signed header, not a query parameter the client could drop.
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false)
    // Regression guard: no SDK-default CRC32 of an empty body.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes('crc32'))).toBe(false)
    expect(presigned.headers).toEqual({
      'content-type': 'image/png',
      'content-length': '9',
      'x-amz-checksum-sha256': hexToBase64(hash),
    })
  })

  it('refuses to put bytes that do not match the expected hash', async () => {
    await expect(
      storage.put('k', Buffer.from('evil'), { expectedSha256: sha256('good') }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError)
  })
})

// Runs against a real S3-compatible server when configured, e.g.
// CIRCI_TEST_S3_ENDPOINT=http://localhost:9000 (MinIO from docker-compose.s3.yml).
const endpoint = process.env.CIRCI_TEST_S3_ENDPOINT
describe.skipIf(!endpoint)('S3Storage (live)', () => {
  const storage = new S3Storage({
    bucket: process.env.CIRCI_TEST_S3_BUCKET ?? 'circi',
    region: 'us-east-1',
    endpoint: endpoint ?? '',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.CIRCI_TEST_S3_ACCESS_KEY ?? 'circi',
      secretAccessKey: process.env.CIRCI_TEST_S3_SECRET_KEY ?? 'circi-dev-secret',
    },
  })

  it('round-trips with a stored checksum', async () => {
    const key = `test/${randomUUID()}`
    await storage.put(key, Buffer.from('hello'), { contentType: 'text/plain' })
    expect(await storage.head(key)).toMatchObject({ size: 5, sha256: sha256('hello') })
    expect(await text(await storage.get(key))).toBe('hello')
    await storage.delete(key)
    expect(await storage.head(key)).toBeNull()
  })

  it('accepts a presigned upload of the right bytes and rejects the wrong ones', async () => {
    const key = `test/${randomUUID()}`
    const body = 'screenshot'
    const presigned = await storage.presignPut(key, {
      sha256: sha256(body),
      contentLength: body.length,
      contentType: 'image/png',
    })
    const bad = await fetch(presigned.url, {
      method: 'PUT',
      headers: presigned.headers,
      body: 'screensh0t',
    })
    expect(bad.ok).toBe(false)
    const good = await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body })
    expect(good.ok).toBe(true)
    expect(await storage.head(key)).toMatchObject({ sha256: sha256(body) })
    await storage.delete(key)
  })
})

const serve = async (status: number) => {
  const { createServer } = await import('node:http')
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/xml' }).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const storage = new S3Storage({
    bucket: 'circi',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
  })
  return { storage, close: () => server.close() }
}

describe('S3Storage.healthCheck failures say what to fix', () => {
  it('a missing bucket names the bucket and the setting', async () => {
    const { storage, close } = await serve(404)
    await expect(storage.healthCheck()).rejects.toThrow(/bucket "circi" does not exist.*S3_BUCKET/)
    close()
  })

  it('refused credentials point at the key settings', async () => {
    const { storage, close } = await serve(403)
    await expect(storage.healthCheck()).rejects.toThrow(/refused access.*S3_ACCESS_KEY_ID/)
    close()
  })

  it('an unreachable endpoint points at S3_ENDPOINT', async () => {
    const storage = new S3Storage({
      bucket: 'circi',
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    })
    await expect(storage.healthCheck()).rejects.toThrow(/Cannot reach S3.*S3_ENDPOINT/)
  })
})

describe('S3Storage timeouts (a server that accepts and never answers)', () => {
  const sockets = new Set<Socket>()
  const silentServer = createNetServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  let silentEndpoint = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve))
    const address = silentServer.address()
    if (address === null || typeof address === 'string') throw new Error('not listening')
    silentEndpoint = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    for (const s of sockets) s.destroy()
    await new Promise((resolve) => silentServer.close(resolve))
  })

  const silent = () =>
    new S3Storage({
      bucket: 'circi',
      region: 'us-east-1',
      endpoint: silentEndpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      connectTimeoutMs: 200,
      requestTimeoutMs: 200,
    })

  it('fails a read within the request timeout instead of hanging', async () => {
    const started = Date.now()
    await expect(silent().head('aa/bb/key')).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('the health check says it timed out and what to raise', async () => {
    const started = Date.now()
    await expect(silent().healthCheck()).rejects.toThrow(
      /did not answer in time.*S3_REQUEST_TIMEOUT_SECONDS/,
    )
    expect(Date.now() - started).toBeLessThan(8000)
  })
})
