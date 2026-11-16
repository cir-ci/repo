import { describe, expect, it } from 'vitest'

import {
  currentSettingsGroup,
  orderedSettingsGroups,
  type SettingsGroup,
} from '#features/sidebar/settings-nav-model.ts'

describe('currentSettingsGroup', () => {
  it.each([
    ['/account/profile', 'account'],
    ['/instance/overview', 'instance'],
    ['/instance/workspaces', 'workspace'],
    ['/workspaces/acme/settings', 'workspace'],
    ['/workspaces/acme/settings/members', 'workspace'],
    ['/workspaces/acme/settings/projects', 'projects'],
    ['/acme/web/settings', 'projects'],
    ['/acme/web/settings/general', 'projects'],
  ])('%s belongs to %s', (path, group) => {
    expect(currentSettingsGroup(path)).toBe(group)
  })
})

describe('orderedSettingsGroups', () => {
  const all = new Set<SettingsGroup>(['account', 'instance', 'workspace', 'projects'])
  it('lists the current group first and keeps the usual order for the rest', () => {
    expect(orderedSettingsGroups('projects', all)).toEqual([
      'projects',
      'account',
      'instance',
      'workspace',
    ])
    expect(orderedSettingsGroups('account', all)).toEqual([
      'account',
      'instance',
      'workspace',
      'projects',
    ])
  })
  it('leaves out the groups that are not there', () => {
    expect(orderedSettingsGroups('projects', new Set(['account', 'projects']))).toEqual([
      'projects',
      'account',
    ])
  })
})
