/**
 * The dev webhook receiver: answers 204 to every POST and prints one line per delivery (the
 * `[hooks]` lines of `pnpm dev`), except on FAILING_HOOK_PATH, which answers 500 so a webhook
 * there shows failed deliveries and retries. Started by main.ts; run alone with
 * `node --conditions=@circi/source dev/src/webhook-receiver.ts`.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { FAILING_HOOK_PATH, PORTS, WEBHOOK_SECRETS_FILE } from './config.ts'
import { describeDelivery, parseSecrets } from './webhook-delivery.ts'

/** A delivery is a small JSON body; anything bigger is refused. */
const MAX_BODY_BYTES = 1024 * 1024

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  let size = 0
  let tooBig = false
  req.on('error', (error) => console.log(`${req.url ?? '/'} request failed: ${error.message}`))
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BODY_BYTES) {
      if (!tooBig) {
        tooBig = true
        console.log(`${req.url ?? '/'} body over ${MAX_BODY_BYTES} bytes, refused`)
        res.writeHead(413, { connection: 'close' }).end()
      }
      chunks.length = 0
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (tooBig) return
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end()
        return
      }
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      const secrets = parseSecrets(await readFile(WEBHOOK_SECRETS_FILE, 'utf8').catch(() => '{}'))
      const { line } = describeDelivery({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        secret: secrets[path],
      })
      const status = path === FAILING_HOOK_PATH ? 500 : 204
      console.log(`${path} ${line} -> ${status}`)
      res.writeHead(status).end()
    })()
  })
})

server.listen(PORTS.hooks, () => console.log(`Listening on http://localhost:${PORTS.hooks}`))
