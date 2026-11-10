import { createECDH, randomBytes } from 'node:crypto'

import { isValidVapidKeys } from '@circi/core/node'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard({ authSecret: 'a-test-secret-of-at-least-32-characters' })
const { client, rivalClient } = fx
afterAll(() => fx.close())

function keys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

describe('push routes', () => {
  it('need a session', async () => {
    expect((await client.anonymous.get('/api/push/public-key')).statusCode).toBe(401)
    expect((await client.anonymous.get('/api/push/devices')).statusCode).toBe(401)
    expect((await client.anonymous.send('POST', '/api/push/subscribe', {})).statusCode).toBe(401)
  })

  it("serves the server's public key, the same each time", async () => {
    const a = (await client.get('/api/push/public-key')).json()
    const b = (await rivalClient.get('/api/push/public-key')).json()
    expect(Buffer.from(a.publicKey, 'base64url')).toHaveLength(65)
    expect(b).toEqual(a)
    expect(isValidVapidKeys({ publicKey: a.publicKey, privateKey: 'x' })).toBe(false)
  })

  it('turns this browser on, lists it with its name, and keeps one row when it re-subscribes', async () => {
    const body = { endpoint: 'https://push.example.com/send/me', keys: keys() }
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: {
        origin: 'https://ci.acme.io',
        'content-type': 'application/json',
        cookie: fx.acmeCookie,
        'user-agent': CHROME_ANDROID,
      },
      payload: JSON.stringify(body),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().devices).toMatchObject([
      { endpoint: body.endpoint, label: 'Chrome on Android', lastUsedAt: null },
    ])
    const again = await client.send('POST', '/api/push/subscribe', { ...body, keys: keys() })
    expect(again.json().devices).toHaveLength(1)
    expect((await client.get('/api/push/devices')).json().devices).toHaveLength(1)
    expect((await rivalClient.get('/api/push/devices')).json().devices).toEqual([])
  })

  it('refuses a bad body, a private address and a non-https one', async () => {
    expect((await client.send('POST', '/api/push/subscribe', {})).statusCode).toBe(400)
    const k = keys()
    const bad = await client.send('POST', '/api/push/subscribe', {
      endpoint: 'https://10.0.0.5/x',
      keys: k,
    })
    expect(bad.statusCode).toBe(400)
    const plain = await client.send('POST', '/api/push/subscribe', {
      endpoint: 'http://push.example.com/x',
      keys: k,
    })
    expect(plain.statusCode).toBe(400)
    const keyless = await client.send('POST', '/api/push/subscribe', {
      endpoint: 'https://push.example.com/y',
      keys: { p256dh: 'AAAA', auth: k.auth },
    })
    expect(keyless.statusCode).toBe(400)
  })

  it("removes only the caller's own devices: someone else's is not found", async () => {
    const mine = await client.send('POST', '/api/push/subscribe', {
      endpoint: 'https://push.example.com/send/remove-me',
      keys: keys(),
    })
    const id = mine
      .json()
      .devices.find((d: { endpoint: string }) => d.endpoint.endsWith('remove-me')).id
    expect((await rivalClient.send('DELETE', `/api/push/devices/${id}`)).statusCode).toBe(404)
    const gone = await client.send('DELETE', `/api/push/devices/${id}`)
    expect(gone.statusCode).toBe(200)
    expect(gone.json().devices.map((d: { id: string }) => d.id)).not.toContain(id)
    expect((await client.send('DELETE', `/api/push/devices/${id}`)).statusCode).toBe(404)
  })

  it('turns this browser off by its endpoint', async () => {
    const endpoint = 'https://push.example.com/send/off'
    await client.send('POST', '/api/push/subscribe', { endpoint, keys: keys() })
    expect((await client.send('POST', '/api/push/unsubscribe', { endpoint })).statusCode).toBe(200)
    const list = (await client.get('/api/push/devices')).json().devices
    expect(list.map((d: { endpoint: string }) => d.endpoint)).not.toContain(endpoint)
  })
})
