import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export interface StaticServer {
  url: string
  close: () => Promise<void>
}

/** Serves a built Storybook from a free local port, for the length of a run. Nothing outside `dir`. */
export async function serveStatic(dir: string): Promise<StaticServer> {
  const root = resolve(dir)
  const server = createServer((req, res) => {
    void (async () => {
      let path: string
      try {
        path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
      } catch {
        res.writeHead(400).end()
        return
      }
      const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path))
      const inside = file === root || file.startsWith(root + sep)
      const info = inside ? await stat(file).catch(() => undefined) : undefined
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
        return
      }
      res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      })
      createReadStream(file).pipe(res)
    })()
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No listening port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done())
        server.closeAllConnections()
      }),
  }
}
