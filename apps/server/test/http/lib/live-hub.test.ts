import type { LiveNotice } from '@circi/core'
import type { ListenFn } from '@circi/db'
import { describe, expect, it } from 'vitest'

import { createLiveHub, liveEventFor } from '#http/lib/live-hub.ts'

const scope = {
  workspaces: [
    { id: 'w1', slug: 'acme', role: 'owner' as const },
    { id: 'w2', slug: 'beta', role: 'member' as const },
    { id: 'w3', slug: 'gamma', role: 'admin' as const },
  ],
  projects: [
    { id: 'p1', slug: 'web', workspaceId: 'w1', isMember: false },
    { id: 'p2', slug: 'app', workspaceId: 'w2', isMember: true },
    { id: 'p3', slug: 'secret', workspaceId: 'w2', isMember: false },
    { id: 'p4', slug: 'docs', workspaceId: 'w3', isMember: false },
  ],
}
const build: LiveNotice = { type: 'build.updated', projectId: 'p1', build: 7 }

describe('liveEventFor', () => {
  it('names the project by its slugs, with the build number', () => {
    expect(liveEventFor(build, 'u1', scope)).toEqual({
      type: 'build.updated',
      workspace: 'acme',
      project: 'web',
      build: 7,
    })
    expect(liveEventFor({ type: 'triage.changed', projectId: 'p1' }, 'u1', scope)).toEqual({
      type: 'triage.changed',
      workspace: 'acme',
      project: 'web',
    })
  })

  it('lets an owner or admin hear every project of their workspace, a member only their own projects', () => {
    expect(liveEventFor({ type: 'review.changed', projectId: 'p1' }, 'u1', scope)).toBeDefined()
    expect(liveEventFor({ type: 'review.changed', projectId: 'p4' }, 'u1', scope)).toBeDefined()
    expect(liveEventFor({ type: 'review.changed', projectId: 'p2' }, 'u1', scope)).toBeDefined()
    expect(liveEventFor({ type: 'review.changed', projectId: 'p3' }, 'u1', scope)).toBeUndefined()
  })

  it('says unknown-project for a project outside the scope (made since, or not theirs)', () => {
    expect(liveEventFor({ type: 'build.created', projectId: 'p9', build: 1 }, 'u1', scope)).toBe(
      'unknown-project',
    )
  })

  it('sends an inbox event to its person only, with nothing but the type', () => {
    expect(liveEventFor({ type: 'notification.created', userId: 'u1' }, 'u1', scope)).toEqual({
      type: 'notification.created',
    })
    expect(
      liveEventFor({ type: 'notification.created', userId: 'u2' }, 'u1', scope),
    ).toBeUndefined()
  })
})

const logger = { warn: () => {} }
const payload = (n: LiveNotice) =>
  JSON.stringify('userId' in n ? { t: n.type, u: n.userId } : { t: n.type, p: n.projectId })

describe('access notices', () => {
  it('never become events, for anyone', () => {
    expect(liveEventFor({ type: 'access.changed', userId: 'u1' }, 'u1', scope)).toBeUndefined()
    expect(
      liveEventFor({ type: 'session.ended', userId: 'u1', sessionId: 's1' }, 'u1', scope),
    ).toBeUndefined()
  })
})

describe('createLiveHub', () => {
  it('listens once for any number of subscribers and hands each notice to all', async () => {
    let listens = 0
    let push: ((payload: string) => void) | undefined
    const listen: ListenFn = async (_channel, onNotify) => {
      listens += 1
      push = onNotify
      return async () => {}
    }
    const hub = createLiveHub({ listen, logger })
    expect(await hub.ready()).toBe(true)
    expect(await hub.ready()).toBe(true)
    const a: LiveNotice[] = []
    const b: LiveNotice[] = []
    hub.subscribe({ notice: (n) => a.push(n), end: () => {} })
    const leave = hub.subscribe({ notice: (n) => b.push(n), end: () => {} })
    push?.(payload({ type: 'triage.changed', projectId: 'p1' }))
    leave()
    push?.(payload({ type: 'build.created', projectId: 'p1' }))
    push?.('garbage')
    expect(listens).toBe(1)
    expect(a.map((n) => n.type)).toEqual(['triage.changed', 'build.created'])
    expect(b.map((n) => n.type)).toEqual(['triage.changed'])
  })

  it('reports not ready when it cannot listen, and tries again on the next ask', async () => {
    let fail = true
    const listen: ListenFn = async () => {
      if (fail) throw new Error('down')
      return async () => {}
    }
    const hub = createLiveHub({ listen, logger })
    expect(await hub.ready()).toBe(false)
    expect(hub.up()).toBe(false)
    fail = false
    expect(await hub.ready()).toBe(true)
    expect(hub.up()).toBe(true)
  })

  it('ends every subscriber when the connection is lost, and listens again on the next ask', async () => {
    let lose: ((err: Error) => void) | undefined
    let listens = 0
    const listen: ListenFn = async (_channel, _onNotify, onLost) => {
      listens += 1
      if (onLost) lose = onLost
      return async () => {}
    }
    const hub = createLiveHub({ listen, logger })
    await hub.ready()
    let ended = 0
    hub.subscribe({ notice: () => {}, end: () => void (ended += 1) })
    hub.subscribe({ notice: () => {}, end: () => void (ended += 1) })
    lose?.(new Error('connection closed'))
    expect(ended).toBe(2)
    expect(hub.up()).toBe(false)
    expect(await hub.ready()).toBe(true)
    expect(listens).toBe(2)
  })

  it('counts its subscribers', async () => {
    const hub = createLiveHub({ listen: async () => async () => {}, logger })
    await hub.ready()
    const leave = hub.subscribe({ notice: () => {}, end: () => {} })
    expect(hub.subscribers()).toBe(1)
    leave()
    expect(hub.subscribers()).toBe(0)
  })

  it('ends subscribers and stops listening on close', async () => {
    let stopped = false
    const listen: ListenFn = async () => async () => void (stopped = true)
    const hub = createLiveHub({ listen, logger })
    await hub.ready()
    let ended = false
    hub.subscribe({ notice: () => {}, end: () => void (ended = true) })
    await hub.close()
    expect(ended).toBe(true)
    expect(stopped).toBe(true)
  })

  it('keeps going when one subscriber throws', async () => {
    let push: ((payload: string) => void) | undefined
    const listen: ListenFn = async (_c, onNotify) => {
      push = onNotify
      return async () => {}
    }
    const hub = createLiveHub({ listen, logger })
    await hub.ready()
    const heard: string[] = []
    hub.subscribe({
      notice: () => {
        throw new Error('boom')
      },
      end: () => {},
    })
    hub.subscribe({ notice: (n) => heard.push(n.type), end: () => {} })
    push?.(payload({ type: 'comment.changed', projectId: 'p1' }))
    expect(heard).toEqual(['comment.changed'])
  })
})
