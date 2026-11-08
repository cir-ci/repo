import { signWebhook } from '@circi/core'
import { afterEach, describe, expect, it } from 'vitest'

import { startWebhookReceiver, type WebhookReceiver } from '../../src/fakes/webhook-receiver.ts'

let receiver: WebhookReceiver | undefined
afterEach(async () => {
  await receiver?.close()
  receiver = undefined
})

const post = (r: WebhookReceiver, body: string, signature: string) =>
  fetch(`http://127.0.0.1:${r.port}/hook`, {
    method: 'POST',
    headers: {
      'circi-signature': signature,
      'circi-event': 'build.completed',
      'circi-delivery': 'd1',
    },
    body,
  })

describe('webhook receiver', () => {
  it('records the delivery and verifies the CirCI signature', async () => {
    receiver = await startWebhookReceiver({ host: '127.0.0.1', secret: 's3cret' })
    const body = JSON.stringify({ event: 'build.completed', build: { number: 3 } })
    expect((await post(receiver, body, signWebhook('s3cret', body))).status).toBe(200)
    expect((await post(receiver, body, signWebhook('wrong', body))).status).toBe(200)
    const [good, bad] = receiver.deliveries
    expect(good).toMatchObject({
      path: '/hook',
      event: 'build.completed',
      deliveryId: 'd1',
      signatureValid: true,
      json: { build: { number: 3 } },
    })
    expect(bad?.signatureValid).toBe(false)
  })

  it('fails on demand a given number of times, then succeeds', async () => {
    receiver = await startWebhookReceiver({ host: '127.0.0.1', secret: 'k' })
    receiver.failWith(500, 2)
    const statuses: number[] = []
    for (let i = 0; i < 3; i++)
      statuses.push((await post(receiver, '{}', signWebhook('k', '{}'))).status)
    expect(statuses).toEqual([500, 500, 200])
    expect(receiver.deliveries.map((d) => d.respondedWith)).toEqual([500, 500, 200])
  })

  it('waits for a delivery that arrives later, and gives up on one that does not', async () => {
    receiver = await startWebhookReceiver({ host: '127.0.0.1' })
    const waiting = receiver.waitFor((d) => d.path === '/hook', { timeoutMs: 5_000 })
    setTimeout(() => void post(receiver!, '{}', 'x'), 100)
    expect((await waiting).respondedWith).toBe(200)
    await expect(receiver.waitFor((d) => d.path === '/nope', { timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    )
  })
})
