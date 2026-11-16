import { describe, expect, it } from 'vitest'

import {
  clickAction,
  entriesToEvict,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_AGE_MS,
  imageKey,
  imageServable,
  imagesToEvict,
  isKeepable,
  mayKeep,
  notificationOptions,
  parsePushPayload,
  sameOriginPath,
  strategyFor,
} from '../../src/sw/logic.ts'

const ORIGIN = 'https://ci.acme.io'
const get = (path: string, mode = 'no-cors') => ({ method: 'GET', url: `${ORIGIN}${path}`, mode })

describe('strategyFor', () => {
  it('answers a page load from the network first, and keeps the hashed assets', () => {
    expect(strategyFor(get('/acme/web/builds/2', 'navigate'), ORIGIN)).toBe('page')
    expect(strategyFor(get('/'), ORIGIN)).toBe('bypass')
    expect(strategyFor(get('/assets/index-7N70cyLn.js'), ORIGIN)).toBe('asset')
    expect(strategyFor(get('/icons/192.png'), ORIGIN)).toBe('static')
    expect(strategyFor(get('/manifest.webmanifest'), ORIGIN)).toBe('static')
  })

  it("never touches /api (people's data), the CI API, probes, webhooks or the worker itself", () => {
    for (const path of [
      '/api/inbox',
      '/api/auth/get-session',
      '/v1/builds',
      '/v2/builds',
      '/webhooks/github',
      '/internal/tls-ask',
      '/healthz',
      '/readyz',
      '/sw.js',
    ]) {
      expect(strategyFor(get(path), ORIGIN)).toBe('bypass')
      // Not even when the browser navigates to it (a download, an OAuth callback).
      expect(strategyFor(get(path, 'navigate'), ORIGIN)).toBe('bypass')
    }
  })

  it('leaves writes and other origins alone', () => {
    expect(strategyFor({ ...get('/assets/a.js'), method: 'POST' }, ORIGIN)).toBe('bypass')
    expect(
      strategyFor(
        { method: 'GET', url: 'https://cdn.example.com/assets/a.js', mode: 'cors' },
        ORIGIN,
      ),
    ).toBe('bypass')
    expect(strategyFor({ method: 'GET', url: 'not a url', mode: 'cors' }, ORIGIN)).toBe('bypass')
  })
})

describe('isKeepable', () => {
  it('keeps only a plain 200 answer', () => {
    expect(isKeepable({ status: 200, type: 'basic' })).toBe(true)
    expect(isKeepable({ status: 404, type: 'basic' })).toBe(false)
    expect(isKeepable({ status: 200, type: 'opaque' })).toBe(false)
    expect(isKeepable({ status: 200, type: 'basic', redirected: true })).toBe(false)
  })
})

describe('entriesToEvict', () => {
  it('drops the oldest beyond the limit', () => {
    expect(entriesToEvict(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b'])
    expect(entriesToEvict(['a', 'b'], 2)).toEqual([])
  })
})

describe('parsePushPayload', () => {
  it('reads what the server sends', () => {
    const body = JSON.stringify({
      title: 'Review requested',
      body: 'Dana asked you to review #148',
      url: '/acme/web/builds/148',
      tag: 'n1',
      project: 'Web app',
    })
    expect(parsePushPayload(body)).toEqual({
      title: 'Review requested',
      body: 'Dana asked you to review #148',
      url: '/acme/web/builds/148',
      tag: 'n1',
      project: 'Web app',
    })
  })

  it('still shows something for a body that is missing or is not ours', () => {
    for (const text of [null, '', 'plain text', '[]', '42']) {
      expect(parsePushPayload(text)).toMatchObject({ title: 'CirCI', url: '/' })
    }
  })

  it('never sends a window to another site', () => {
    for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
      expect(parsePushPayload(JSON.stringify({ title: 't', url })).url).toBe('/')
    }
  })

  it('treats a backslash as the slash it is to the browser', () => {
    for (const url of ['/\\evil.example', '/\\/evil.example', '\\\\evil.example', '/%5Cx/..']) {
      const out = parsePushPayload(JSON.stringify({ title: 't', url })).url
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN)
    }
    expect(parsePushPayload(JSON.stringify({ title: 't', url: '/\\evil.example' })).url).toBe('/')
    expect(parsePushPayload(JSON.stringify({ title: 't', url: '/acme/web?x=1#c' })).url).toBe(
      '/acme/web?x=1#c',
    )
  })
})

describe('sameOriginPath', () => {
  it('returns path, search and hash for this origin only', () => {
    expect(sameOriginPath('/a/b?x=1#h', ORIGIN)).toBe('/a/b?x=1#h')
    expect(sameOriginPath(`${ORIGIN}/a?x=1`, ORIGIN)).toBe('/a?x=1')
    expect(sameOriginPath('/\\evil.example', ORIGIN)).toBeNull()
    expect(sameOriginPath('//evil.example', ORIGIN)).toBeNull()
    expect(sameOriginPath('https://evil.example/a', ORIGIN)).toBeNull()
  })
})

describe('kept screenshots belong to a person and expire', () => {
  const now = 10_000_000_000
  it('serves a fresh copy to the person it was kept for', () => {
    expect(imageServable({ owner: 'u1', storedAt: now - 1000 }, 'u1', now)).toBe(true)
    expect(imageServable({ owner: 'u1', storedAt: now - IMAGE_MAX_AGE_MS }, 'u1', now)).toBe(true)
  })

  it('misses once the link window has passed, and for anything it cannot vouch for', () => {
    expect(imageServable({ owner: 'u1', storedAt: now - IMAGE_MAX_AGE_MS - 1 }, 'u1', now)).toBe(
      false,
    )
    expect(imageServable({ owner: 'u1', storedAt: now + 5 }, 'u1', now)).toBe(false)
    expect(imageServable({ owner: 'u1' }, 'u1', now)).toBe(false)
    expect(imageServable({ owner: 'u1', storedAt: Number.NaN }, 'u1', now)).toBe(false)
    expect(imageServable(null, 'u1', now)).toBe(false)
  })

  it("never serves another person's copy, nor any when nobody is known", () => {
    expect(imageServable({ owner: 'u1', storedAt: now }, 'u2', now)).toBe(false)
    expect(imageServable({ owner: 'u1', storedAt: now }, null, now)).toBe(false)
  })

  it('stores a result only if nothing was forgotten since the fetch began', () => {
    expect(mayKeep(3, 3)).toBe(true)
    expect(mayKeep(3, 4)).toBe(false)
  })
})

describe('notificationOptions', () => {
  it('carries the target and the notification ID, and replaces a repeat by its tag', () => {
    expect(
      notificationOptions({ title: 't', body: 'b', url: '/x', tag: 'n1', project: null }),
    ).toMatchObject({ body: 'b', tag: 'n1', data: { url: '/x', tag: 'n1' } })
    expect(
      notificationOptions({ title: 't', body: 'b', url: '/x', tag: '', project: null }),
    ).not.toHaveProperty('tag')
  })
})

describe('clickAction', () => {
  const windows = [
    { url: `${ORIGIN}/acme/web/reviews` },
    { url: 'https://elsewhere.example/' },
    { url: `${ORIGIN}/acme/web/builds/148?tab=changes` },
  ]

  it('focuses a window already on the page', () => {
    expect(clickAction(windows, '/acme/web/reviews', ORIGIN)).toEqual({ kind: 'focus', index: 0 })
    expect(clickAction(windows, '/acme/web/builds/148?tab=changes', ORIGIN)).toEqual({
      kind: 'focus',
      index: 2,
    })
  })

  it('takes an open app window to the page when none shows it', () => {
    expect(clickAction(windows, '/acme/web/builds/149', ORIGIN)).toEqual({
      kind: 'navigate',
      index: 0,
    })
    // The query matters: the same path with another query is another page.
    expect(clickAction(windows, '/acme/web/builds/148', ORIGIN)).toEqual({
      kind: 'navigate',
      index: 0,
    })
  })

  it('opens a window when no app window is open, ignoring other sites', () => {
    expect(clickAction([], '/acme', ORIGIN)).toEqual({ kind: 'open' })
    expect(clickAction([{ url: 'https://elsewhere.example/' }], '/acme', ORIGIN)).toEqual({
      kind: 'open',
    })
  })
})

const files = (n: number, size: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, size }))

describe('screenshots (/api/files/<sha256>)', () => {
  const sha = 'a'.repeat(64)
  const other = 'b'.repeat(64)

  it('answers a screenshot from the cache first, and still never touches other /api paths', () => {
    expect(strategyFor(get(`/api/files/${sha}?exp=1&sig=x`), ORIGIN)).toBe('image')
    expect(strategyFor(get(`/api/files/${sha}`), ORIGIN)).toBe('image')
    expect(strategyFor(get('/api/files/not-a-hash'), ORIGIN)).toBe('bypass')
    expect(strategyFor(get(`/api/files/${sha}/extra`), ORIGIN)).toBe('bypass')
    expect(strategyFor(get('/api/inbox'), ORIGIN)).toBe('bypass')
  })

  it('keys a screenshot by its path: the signature that changes every hour is not part of it', () => {
    const key = `${ORIGIN}/api/files/${sha}`
    expect(imageKey(`${ORIGIN}/api/files/${sha}?exp=100&sig=aaa`, ORIGIN)).toBe(key)
    expect(imageKey(`${ORIGIN}/api/files/${sha}?exp=999&sig=zzz`, ORIGIN)).toBe(key)
    expect(imageKey(`${ORIGIN}/api/files/${other}`, ORIGIN)).not.toBe(key)
  })

  it('keys nothing else', () => {
    expect(imageKey(`${ORIGIN}/api/inbox`, ORIGIN)).toBeNull()
    expect(imageKey(`https://evil.test/api/files/${sha}`, ORIGIN)).toBeNull()
    expect(imageKey('not a url', ORIGIN)).toBeNull()
  })

  it('evicts the least recently used first, by count and by bytes', () => {
    expect(imagesToEvict(files(IMAGE_MAX_COUNT, 1))).toEqual([])
    expect(imagesToEvict(files(IMAGE_MAX_COUNT + 2, 1))).toEqual(['k0', 'k1'])
    // Three files of 1/2 the byte cap: the first goes.
    expect(imagesToEvict(files(3, IMAGE_MAX_BYTES / 2))).toEqual(['k0'])
    expect(imagesToEvict(files(3, 10), 2, 1000)).toEqual(['k0'])
    expect(imagesToEvict([])).toEqual([])
  })
})
