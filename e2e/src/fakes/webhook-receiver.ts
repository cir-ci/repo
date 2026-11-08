import { verifyWebhookSignature } from '@circi/core'

import { listen, readBody, waitUntil } from './http.ts'

export interface Delivery {
  /** Request path, e.g. `/hook`. */
  path: string
  headers: Record<string, string | string[] | undefined>
  rawBody: string
  /** The parsed body, `undefined` when it was not JSON. */
  json: unknown
  /** The `CirCI-Event` header (e.g. `build.completed`). */
  event: string | undefined
  /** The `CirCI-Delivery` header: the same id on every retry of one delivery. */
  deliveryId: string | undefined
  /** `CirCI-Signature` verifies against the receiver's secret (false when no secret is set). */
  signatureValid: boolean
  /** The status this receiver answered. */
  respondedWith: number
  receivedAt: Date
}

export interface WebhookReceiver {
  /** The address CirCI posts to, from the container: `http://host.docker.internal:<port>`. */
  url: string
  port: number
  deliveries: Delivery[]
  /** The signing secret CirCI printed when the webhook was created. */
  setSecret(secret: string): void
  /** Answers the next `times` deliveries with `status` (default: all following ones, until `succeed()`). */
  failWith(status: number, times?: number): void
  succeed(): void
  /** Waits until a delivery matching `predicate` (default: any new one) has arrived. */
  waitFor(
    predicate?: (d: Delivery) => boolean,
    options?: { timeoutMs?: number; since?: number },
  ): Promise<Delivery>
  clear(): void
  close(): Promise<void>
}

/**
 * A webhook endpoint on the host: records each delivery with its headers and raw body, verifies
 * the `CirCI-Signature` with @circi/core's signing, and can fail on demand to test retries.
 */
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export async function startWebhookReceiver(
  options: { host?: string; secret?: string } = {},
): Promise<WebhookReceiver> {
  const deliveries: Delivery[] = []
  const state = { secret: options.secret, status: 200, remaining: Infinity }

  const listening = await listen((req, res) => {
    void (async () => {
      const raw = (await readBody(req)).toString('utf8')
      const header = req.headers['circi-signature']
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        json = undefined
      }
      const failing = state.status >= 400 && state.remaining > 0
      const status = failing ? state.status : 200
      if (failing) state.remaining -= 1
      deliveries.push({
        path: req.url ?? '/',
        headers: req.headers,
        rawBody: raw,
        event: first(req.headers['circi-event']),
        deliveryId: first(req.headers['circi-delivery']),
        json,
        signatureValid:
          state.secret !== undefined &&
          typeof header === 'string' &&
          verifyWebhookSignature(state.secret, raw, header),
        respondedWith: status,
        receivedAt: new Date(),
      })
      res.statusCode = status
      res.end(status === 200 ? 'ok' : 'failing on purpose')
    })()
  })

  return {
    url: `http://${options.host ?? 'host.docker.internal'}:${listening.port}`,
    port: listening.port,
    deliveries,
    setSecret(secret) {
      state.secret = secret
    },
    failWith(status, times = Infinity) {
      state.status = status
      state.remaining = times
    },
    succeed() {
      state.status = 200
      state.remaining = Infinity
    },
    waitFor(predicate = () => true, o = {}) {
      const since = o.since ?? 0
      return waitUntil(
        () => deliveries.slice(since).find(predicate),
        'a webhook delivery',
        o.timeoutMs ?? 30_000,
      )
    },
    clear() {
      deliveries.length = 0
    },
    close: () => listening.close(),
  }
}
