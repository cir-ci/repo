import { signFileUrl } from '@circi/core/node'
import { afterAll, describe, expect, it } from 'vitest'

import { png, sha, startDashboard } from '#test/support/dashboard-fixture.ts'

const secret = 'file-link-secret-that-is-long-enough-1234'
const fx = await startDashboard({ authSecret: secret })
afterAll(() => fx.close())

const detail = (await fx.buildDetail(fx.acmeCookie)).json()
const home = detail.diffs.find((d: { name: string }) => d.name === 'home')
const hash: string = home.head.sha256
const other: string = home.diff.sha256

const link = (h: string, signature: { exp: number | string; sig: string }) =>
  `/api/files/${h}?exp=${signature.exp}&sig=${signature.sig}`
const signed = (h: string) => signFileUrl(secret, h)
/** A request with no cookie at all: only a signature can get it in. */
const anonymous = (url: string, headers: Record<string, string> = {}) =>
  fx.app.inject({ method: 'GET', url, headers })

describe('signed file links', () => {
  it('signs the hashes a reply carries, for the web app to use', () => {
    const [exp, sig] = detail.fileSignatures[hash].split('.')
    expect(signed(hash)).toEqual({ exp: Number(exp), sig })
    expect(Object.keys(detail.fileSignatures)).toEqual(expect.arrayContaining([hash, other]))
  })

  it('serves a valid signature with no session, with permanent caching', async () => {
    const res = await anonymous(link(hash, signed(hash)))
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(res.headers.etag).toBe(`"${hash}"`)
    expect(sha(res.rawPayload)).toBe(hash)
  })

  it('answers a conditional request from the signature alone, and a repeat without any query', async () => {
    const url = link(other, signed(other))
    fx.queries.reset()
    const cached = await anonymous(url, { 'if-none-match': `"${other}"` })
    expect(cached.statusCode).toBe(304)
    expect(fx.queries.count()).toBe(0)

    // The first read of a file looks up where it is; after that nothing touches the database.
    await anonymous(url)
    fx.queries.reset()
    const again = await anonymous(url)
    expect(again.statusCode).toBe(200)
    expect(fx.queries.count()).toBe(0)
  })

  it('costs one statement for a first read: no session, no access query', async () => {
    const later = await fx.buildWith(fx.acme.project.id, 'aaaa003', ['aaaa002'], {
      home: await png('#00ff00'),
    })
    const newest = await fx.get(`/api/projects/${fx.acme.workspaceSlug}/web/builds/${later.number}`)
    const newHash: string = newest.json().diffs.find((d: { name: string }) => d.name === 'home')
      .head.sha256
    fx.queries.reset()
    const res = await anonymous(link(newHash, signed(newHash)))
    expect(res.statusCode).toBe(200)
    expect(fx.queries.count()).toBe(1)
  })

  it('refuses an expired, forged or mismatched signature when there is no session', async () => {
    const expired = signFileUrl(secret, hash, { now: Date.now() - 3 * 3600_000 })
    expect((await anonymous(link(hash, expired))).statusCode).toBe(401)
    const forged = signed(hash)
    expect((await anonymous(link(hash, { ...forged, sig: 'A'.repeat(22) }))).statusCode).toBe(401)
    expect((await anonymous(link(hash, { ...forged, exp: forged.exp + 3600 }))).statusCode).toBe(
      401,
    )
    // A signature for one file opens no other.
    expect((await anonymous(link(other, signed(hash)))).statusCode).toBe(401)
    expect(
      (await anonymous(link(hash, signFileUrl('another-secret-entirely-0123456789', hash))))
        .statusCode,
    ).toBe(401)
    expect((await anonymous(`/api/files/${hash}`)).statusCode).toBe(401)
  })

  it('lets a good session through even when the link has expired, and still checks access', async () => {
    const expired = signFileUrl(secret, hash, { now: Date.now() - 3 * 3600_000 })
    const url = link(hash, expired)
    expect((await fx.get(url)).statusCode).toBe(200)
    expect((await fx.get(url, fx.rivalCookie)).statusCode).toBe(404)
  })

  it('does not sign anything when the server has no secret', async () => {
    const plain = await startDashboard()
    try {
      expect((await plain.buildDetail(plain.acmeCookie)).json().fileSignatures).toBeUndefined()
      const res = await plain.app.inject({
        method: 'GET',
        url: link(hash, signed(hash)),
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await plain.close()
    }
  })
})
