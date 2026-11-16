import type { Live } from '@circi/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { liveInvalidations, parseLiveEvent } from '#lib/live-keys.ts'
import { keys } from '#lib/query-keys.ts'

/** Whether invalidating `key` would reach a query cached under `queryKey` (TanStack's prefix match). */
const reaches = (key: readonly unknown[], queryKey: readonly unknown[]) => {
  const client = new QueryClient()
  client.setQueryData(queryKey, 1)
  const hit = client.getQueryCache().findAll({ queryKey: key }).length > 0
  client.clear()
  return hit
}
const reached = (event: Live.Event, queryKey: readonly unknown[]) =>
  liveInvalidations(event).some((key) => reaches(key, queryKey))

const build: Live.Event = { type: 'build.updated', workspace: 'acme', project: 'web', build: 7 }

describe('liveInvalidations', () => {
  it('a build event refetches that build, its project and workspace lists, and what shows the same facts', () => {
    for (const type of ['build.created', 'build.finalized', 'build.updated'] as const) {
      const event = { ...build, type }
      expect(reached(event, keys.build('acme', 'web', 7))).toBe(true)
      expect(reached(event, keys.activity('acme', 'web', 7))).toBe(true)
      expect(reached(event, keys.project('acme', 'web', null, 'q', 'oldest'))).toBe(true)
      expect(reached(event, keys.workspaceBuilds('acme', null))).toBe(true)
      expect(reached(event, keys.triage('acme', 'web'))).toBe(true)
      expect(reached(event, keys.flaky('acme', 'web'))).toBe(true)
      expect(reached(event, keys.reviews('for-you'))).toBe(true)
      expect(reached(event, keys.sidebar('acme'))).toBe(true)
    }
  })

  it("leaves other builds, other projects and other workspaces' queries alone", () => {
    expect(reached(build, keys.build('acme', 'web', 8))).toBe(false)
    expect(reached(build, keys.build('acme', 'app', 7))).toBe(false)
    expect(reached(build, keys.build('rival', 'web', 7))).toBe(false)
    expect(reached(build, keys.project('acme', 'app'))).toBe(false)
    expect(reached(build, keys.workspaceBuilds('rival', null))).toBe(false)
    expect(reached(build, keys.sidebar('rival'))).toBe(false)
    expect(reached(build, keys.projectSettings('acme', 'web'))).toBe(false)
    expect(reached(build, keys.instanceHealth())).toBe(false)
  })

  it("a comment refetches the build's comments, activity and detail, not its neighbors", () => {
    const event: Live.Event = {
      type: 'comment.changed',
      workspace: 'acme',
      project: 'web',
      build: 7,
    }
    expect(reached(event, keys.comments('acme', 'web', 7))).toBe(true)
    expect(reached(event, keys.activity('acme', 'web', 7))).toBe(true)
    expect(reached(event, keys.build('acme', 'web', 7))).toBe(true)
    expect(reached(event, keys.comments('acme', 'web', 8))).toBe(false)
    expect(reached(event, keys.reviews())).toBe(false)
  })

  it('a decision on a build refetches it and the review lists and inbox; one on no build, every build page of the project', () => {
    const decided: Live.Event = {
      type: 'review.changed',
      workspace: 'acme',
      project: 'web',
      build: 7,
    }
    expect(reached(decided, keys.build('acme', 'web', 7))).toBe(true)
    expect(reached(decided, keys.build('acme', 'web', 8))).toBe(false)
    expect(reached(decided, keys.reviews('for-you'))).toBe(true)
    expect(reached(decided, keys.inbox('unread'))).toBe(true)
    const requested: Live.Event = { type: 'review.changed', workspace: 'acme', project: 'web' }
    expect(reached(requested, keys.build('acme', 'web', 8))).toBe(true)
    expect(reached(requested, keys.build('acme', 'app', 8))).toBe(false)
    expect(reached(requested, keys.reviews('for-you'))).toBe(true)
  })

  it('an inbox event refetches the inbox and every workspace sidebar, nothing of a project', () => {
    for (const type of ['notification.created', 'notification.read'] as const) {
      const event: Live.Event = { type }
      expect(reached(event, keys.inbox('unread'))).toBe(true)
      expect(reached(event, keys.sidebar('acme'))).toBe(true)
      expect(reached(event, keys.sidebar('rival'))).toBe(true)
      expect(reached(event, keys.build('acme', 'web', 7))).toBe(false)
    }
  })

  it("a triage event refetches that project's queue, regions and sidebar", () => {
    const event: Live.Event = { type: 'triage.changed', workspace: 'acme', project: 'web' }
    expect(reached(event, keys.triage('acme', 'web'))).toBe(true)
    expect(reached(event, keys.ignoreRegions('acme', 'web'))).toBe(true)
    expect(reached(event, keys.sidebar('acme'))).toBe(true)
    expect(reached(event, keys.triage('acme', 'app'))).toBe(false)
    expect(reached(event, keys.build('acme', 'web', 7))).toBe(false)
  })

  it('a resync refetches everything', () => {
    for (const queryKey of [
      keys.build('a', 'b', 1),
      keys.inbox(),
      keys.instanceHealth(),
      keys.workspace('a'),
    ]) {
      expect(reached({ type: 'resync' }, queryKey)).toBe(true)
    }
  })

  it('falls back to the whole family when an event lacks its slugs, never to nothing', () => {
    expect(liveInvalidations({ type: 'build.updated' }).length).toBeGreaterThan(0)
    expect(reached({ type: 'build.updated' }, keys.build('acme', 'web', 7))).toBe(true)
    expect(reached({ type: 'triage.changed' }, keys.triage('acme', 'web'))).toBe(true)
    expect(reached({ type: 'comment.changed' }, keys.comments('acme', 'web', 7))).toBe(true)
  })
})

describe('parseLiveEvent', () => {
  it('reads an event and keeps only what it knows', () => {
    expect(
      parseLiveEvent('{"type":"build.updated","workspace":"acme","project":"web","build":7,"x":1}'),
    ).toEqual(build)
    expect(parseLiveEvent('{"type":"notification.read"}')).toEqual({ type: 'notification.read' })
  })

  it("ignores what isn't an event: garbage, a newer server's type, a non-string message", () => {
    expect(parseLiveEvent('nope')).toBeUndefined()
    expect(parseLiveEvent('null')).toBeUndefined()
    expect(parseLiveEvent('{"type":"from.the.future"}')).toBeUndefined()
    expect(parseLiveEvent('{"workspace":"acme"}')).toBeUndefined()
    expect(parseLiveEvent(42)).toBeUndefined()
  })

  it('drops fields of the wrong type', () => {
    expect(parseLiveEvent('{"type":"build.updated","workspace":1,"build":"7"}')).toEqual({
      type: 'build.updated',
    })
  })
})
