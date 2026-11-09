import { describe, expect, it } from 'vitest'

import { filterCatalog, INTEGRATION_GROUPS, type IntegrationCatalog } from '#src/index.ts'
import { openSecret, sealSecret } from '#src/node/index.ts'

const ENTRIES: readonly IntegrationCatalog.Entry[] = [
  {
    kind: 'azure-devops',
    group: 'git',
    name: 'Azure DevOps',
    description: 'Build status.',
    status: 'planned',
  },
  {
    kind: 'teams',
    group: 'chat',
    name: 'Microsoft Teams',
    description: 'Review notices.',
    status: 'planned',
  },
  {
    kind: 'penpot',
    group: 'design',
    name: 'Penpot',
    description: 'Link boards.',
    status: 'planned',
  },
]

describe('filterCatalog', () => {
  it('filters by text and group', () => {
    expect(filterCatalog(ENTRIES, { query: 'azure' }).map((e) => e.kind)).toEqual(['azure-devops'])
    expect(filterCatalog(ENTRIES, { group: 'chat' }).map((e) => e.kind)).toEqual(['teams'])
    expect(filterCatalog(ENTRIES, { group: 'all' })).toHaveLength(ENTRIES.length)
    expect(filterCatalog(ENTRIES, { query: 'JIRA', group: 'design' })).toEqual([])
    expect(filterCatalog(ENTRIES, { query: 'azure' })).toHaveLength(1)
    for (const e of ENTRIES) expect(INTEGRATION_GROUPS).toContain(e.group)
  })
})

describe('sealed secrets', () => {
  it('round-trips, and fails closed on another secret or tampering', () => {
    const sealed = sealSecret('instance-secret', 'xoxb-token')
    expect(sealed).not.toContain('xoxb')
    expect(openSecret('instance-secret', sealed)).toBe('xoxb-token')
    expect(openSecret('other', sealed)).toBeUndefined()
    expect(openSecret('instance-secret', `${sealed}x`)).toBeUndefined()
    expect(openSecret('instance-secret', 'garbage')).toBeUndefined()
    expect(sealSecret('instance-secret', 'xoxb-token')).not.toBe(sealed)
  })
})
