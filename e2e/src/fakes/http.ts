import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface Listening {
  server: Server
  port: number
  close(): Promise<void>
}

/**
 * Listens on all interfaces on a free port: the circi container reaches the host's fakes through
 * `host.docker.internal` (docker's host-gateway), which is not loopback.
 */
export async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Listening> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('not listening')
  return {
    server,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Polls `read` until it returns something, or throws after `timeoutMs`. */
export async function waitUntil<T>(
  read: () => T | undefined,
  what: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await sleep(50)
  }
}
