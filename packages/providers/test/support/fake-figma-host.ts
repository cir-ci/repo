const json = (data: unknown, status = 200) => Response.json(data, { status })

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

  const fetcher: typeof fetch = async (input, init) => {
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

  return { fetch: fetcher, comments, requests }
}
