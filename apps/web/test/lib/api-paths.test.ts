import { describe, expect, it } from 'vitest'

import { inboxPath, instancePath, teamPath, workspacePath } from '#lib/api-paths.ts'

describe('teamPath', () => {
  it('builds the team root and its sub-resources', () => {
    expect(teamPath('acme', 'web')).toBe('/api/teams/acme/web')
    expect(teamPath('acme', 'web', 'rules', 'order')).toBe('/api/teams/acme/web/rules/order')
  })

  it('escapes slugs and values, and stringifies numbers', () => {
    expect(teamPath('a b', 'c/d', 'builds', 12, 'review')).toBe(
      '/api/teams/a%20b/c%2Fd/builds/12/review',
    )
    expect(teamPath('acme', 'web', 'ignore-regions', '../x?y#z')).toBe(
      '/api/teams/acme/web/ignore-regions/..%2Fx%3Fy%23z',
    )
  })

  it('leaves a query string to the caller', () => {
    expect(`${teamPath('acme', 'web', 'snapshots', 'a b', 'history')}?limit=5`).toBe(
      '/api/teams/acme/web/snapshots/a%20b/history?limit=5',
    )
  })
})

describe('workspacePath', () => {
  it('builds the workspace root and its sub-resources', () => {
    expect(workspacePath('acme')).toBe('/api/workspaces/acme')
    expect(workspacePath('acme', 'builds', 'suggestions')).toBe(
      '/api/workspaces/acme/builds/suggestions',
    )
    expect(workspacePath('ac me', 'pinned-teams', 'a/b')).toBe(
      '/api/workspaces/ac%20me/pinned-teams/a%2Fb',
    )
  })
})

describe('instancePath and inboxPath', () => {
  it('prefix and escape', () => {
    expect(instancePath('accounts', 'u 1', 'ban')).toBe('/api/instance/accounts/u%201/ban')
    expect(instancePath('settings')).toBe('/api/instance/settings')
    expect(inboxPath()).toBe('/api/inbox')
    expect(inboxPath('i/1', 'read')).toBe('/api/inbox/i%2F1/read')
  })
})
