/**
 * The dev webhook receiver: answers 204 to every POST and prints one line per delivery (the
 * `[hooks]` lines of `pnpm dev`). Started by main.ts; run alone with
 * `node --conditions=@circi/source dev/src/webhook-receiver.ts`.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { PORTS, WEBHOOK_SECRETS_FILE } from './config.ts'
import { describeDelivery, parseSecrets } from './webhook-delivery.ts'

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end()
        return
      }
      const secrets = parseSecrets(await readFile(WEBHOOK_SECRETS_FILE, 'utf8').catch(() => '[]'))
      const { line } = describeDelivery({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        secrets,
      })
      console.log(`${req.url ?? '/'} ${line}`)
      res.writeHead(204).end()
    })()
  })
})

server.listen(PORTS.hooks, () => console.log(`Listening on http://localhost:${PORTS.hooks}`))
