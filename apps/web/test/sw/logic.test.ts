import { describe, expect, it } from 'vitest'

import {
  clickAction,
  entriesToEvict,
  isKeepable,
  notificationOptions,
  parsePushPayload,
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
      team: 'Web app',
    })
    expect(parsePushPayload(body)).toEqual({
      title: 'Review requested',
      body: 'Dana asked you to review #148',
      url: '/acme/web/builds/148',
      tag: 'n1',
      team: 'Web app',
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
})

describe('notificationOptions', () => {
  it('carries the target and the notification ID, and replaces a repeat by its tag', () => {
    expect(
      notificationOptions({ title: 't', body: 'b', url: '/x', tag: 'n1', team: null }),
    ).toMatchObject({ body: 'b', tag: 'n1', data: { url: '/x', tag: 'n1' } })
    expect(
      notificationOptions({ title: 't', body: 'b', url: '/x', tag: '', team: null }),
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
