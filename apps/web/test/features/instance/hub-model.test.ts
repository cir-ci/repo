import { describe, expect, it } from 'vitest'

import {
  hostOfUrl,
  instanceHubGroups,
  instanceHubTitle,
  onInstancePage,
} from '#features/instance/hub-model.ts'

describe('instanceHubGroups', () => {
  const facts = { accountCount: 12, workspaceCount: 1, publicUrl: 'https://ci.acme.io' }

  it('lists People, Workspaces and Server with one row for each page', () => {
    expect(instanceHubGroups(facts).map((g) => [g.title, g.rows.map((r) => r.key)])).toEqual([
      ['People', ['accounts']],
      ['Workspaces', ['workspaces']],
      ['Server', ['settings', 'health']],
    ])
  })

  it('summarises with counts that carry their noun, and the address', () => {
    const values = instanceHubGroups(facts).flatMap((g) => g.rows.map((r) => r.value))
    expect(values).toEqual(['12 accounts', '1 workspace', 'ci.acme.io', undefined])
  })

  it('has no summary for what is still loading', () => {
    const values = instanceHubGroups({
      accountCount: undefined,
      workspaceCount: undefined,
      publicUrl: undefined,
    }).flatMap((g) => g.rows.map((r) => r.value))
    expect(values).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('instanceHubTitle', () => {
  it('is Instance at its host', () => {
    expect(instanceHubTitle('https://ci.acme.io:8443/')).toEqual({
      name: 'Instance',
      subtitle: 'ci.acme.io:8443',
    })
    expect(instanceHubTitle(undefined)).toEqual({ name: 'Instance', subtitle: undefined })
  })

  it('keeps text that is not a URL', () => {
    expect(hostOfUrl('localhost')).toBe('localhost')
  })
})

describe('onInstancePage', () => {
  it.each([
    ['/instance', true],
    ['/instance/overview', true],
    ['/instance/accounts', true],
    ['/instance/settings', true],
    ['/instance/health', true],
    ['/instance/workspaces', false],
    ['/instance/workspaces/', false],
    ['/instances', false],
    ['/account/profile', false],
    ['/workspaces/acme/settings', false],
  ])('%s -> %s', (path, expected) => {
    expect(onInstancePage(path)).toBe(expected)
  })
})
