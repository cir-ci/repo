import { fakeHost, jsonResponse as json } from './types.ts'

export interface FakeFigmaFile {
  key: string
  name: string
  pages: { id: string; name: string; children: { id: string; name: string; type?: string }[] }[]
}

/**
 * A stateful fake of Figma's HTTP edge: tokens map to users, files have pages with frames,
 * comments are kept. Only what `FigmaClient` calls, with Figma's response shapes and its 403 for
 * a bad token and 404 for a file the token can't see.
 */
export function fakeFigmaHost(options: {
  tokens: Record<string, { id: string; handle: string; email?: string }>
  files: FakeFigmaFile[]
}) {
  let nextId = 1
  const comments: { id: string; fileKey: string; message: string; nodeId: string | undefined }[] =
    []
  const requests: { method: string; path: string; token: string | null }[] = []

  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const header = req.headers.get('x-figma-token')
    const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? null
    const token = header ?? bearer
    requests.push({ method: req.method, path: url.pathname + url.search, token })
    const user = token ? options.tokens[token] : undefined
    if (!user) return json({ status: 403, err: 'Invalid token' }, 403)

    if (req.method === 'GET' && url.pathname === '/v1/me') return json(user)

    const m = /^\/v1\/(files|images)\/([^/]+)(\/nodes|\/comments)?$/.exec(url.pathname)
    const file = m ? options.files.find((f) => f.key === m[2]) : undefined
    if (!m || !file) return json({ status: 404, err: 'Not found' }, 404)
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)

    if (req.method === 'GET' && m[1] === 'files' && !m[3]) {
      return json({
        name: file.name,
        document: {
          id: '0:0',
          name: 'Document',
          children: file.pages.map(({ id, name }) => ({ id, name, type: 'CANVAS' })),
        },
      })
    }
    if (req.method === 'GET' && m[3] === '/nodes') {
      const nodes: Record<string, unknown> = {}
      for (const id of ids) {
        const page = file.pages.find((p) => p.id === id)
        const frame = file.pages.flatMap((p) => p.children).find((c) => c.id === id)
        nodes[id] = page
          ? {
              document: {
                id: page.id,
                name: page.name,
                type: 'CANVAS',
                children: page.children.map((c) => ({
                  id: c.id,
                  name: c.name,
                  type: c.type ?? 'FRAME',
                })),
              },
            }
          : frame
            ? { document: { id: frame.id, name: frame.name, type: frame.type ?? 'FRAME' } }
            : null
      }
      return json({ name: file.name, nodes })
    }
    if (req.method === 'GET' && m[1] === 'images') {
      const known = new Set(file.pages.flatMap((p) => p.children.map((c) => c.id)))
      return json({
        err: null,
        images: Object.fromEntries(
          ids.map((id) => [
            id,
            known.has(id) ? `https://figma-alpha-api.s3.example/${id}.png` : null,
          ]),
        ),
      })
    }
    if (req.method === 'POST' && m[3] === '/comments') {
      const body: unknown = JSON.parse(await req.text())
      const meta: unknown = Reflect.get(Object(body), 'client_meta')
      const node: unknown = meta ? Reflect.get(Object(meta), 'node_id') : undefined
      const comment = {
        id: String(nextId++),
        fileKey: file.key,
        message: String(Reflect.get(Object(body), 'message')),
        nodeId: typeof node === 'string' ? node : undefined,
      }
      comments.push(comment)
      return json({ id: comment.id, message: comment.message }, 200)
    }
    return json({ status: 404, err: 'Not found' }, 404)
  }

  const base = fakeHost(behaviour)
  return { ...base, fetch: base.fetcher, comments, requests }
}

/** Figma's HTTP edge: one token, one file with a page and two frames, comments kept. */
export function fakeFigmaFileHost(options: { down?: boolean } = {}) {
  const comments: unknown[] = []
  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (options.down) return new Response('boom', { status: 500 })
    if (req.headers.get('x-figma-token') !== 'figd_good') {
      return Response.json({ err: 'Invalid token' }, { status: 403 })
    }
    if (url.pathname === '/v1/me') return Response.json({ id: 'fu-1', handle: 'michael' })
    if (url.pathname.startsWith('/v1/images/')) {
      return Response.json({ images: { '1:2': 'https://img.test/cart.png' } })
    }
    if (url.pathname.endsWith('/comments')) {
      comments.push(await req.json())
      return Response.json({ id: 'c1' })
    }
    if (!url.pathname.startsWith('/v1/files/FileKey12345')) {
      return Response.json({ err: 'Not found' }, { status: 404 })
    }
    if (url.pathname.endsWith('/nodes')) {
      const ids = (url.searchParams.get('ids') ?? '').split(',')
      const nodes = {
        '0:1': {
          document: {
            id: '0:1',
            name: 'Pages',
            children: [
              { id: '1:1', name: 'Home', type: 'FRAME' },
              { id: '1:2', name: 'Cart', type: 'FRAME' },
            ],
          },
        },
        '1:2': { document: { id: '1:2', name: 'Cart', type: 'FRAME', children: [] } },
      }
      return Response.json({
        nodes: Object.fromEntries(ids.map((id) => [id, Reflect.get(nodes, id) ?? null])),
      })
    }
    return Response.json({
      name: 'Checkout v3',
      document: { id: '0:0', name: 'Document', children: [{ id: '0:1', name: 'Pages' }] },
    })
  }
  return { ...fakeHost(behaviour), comments }
}
