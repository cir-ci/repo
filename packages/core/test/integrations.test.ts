import { describe, expect, it } from 'vitest'

import { catalogEntry, filterCatalog, INTEGRATION_CATALOG, INTEGRATION_GROUPS } from '#src/index.ts'
import { openSecret, sealSecret } from '#src/node/index.ts'

describe('integration catalog', () => {
  it('has unique kinds, each in a known group', () => {
    const kinds = INTEGRATION_CATALOG.map((e) => e.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const e of INTEGRATION_CATALOG) expect(INTEGRATION_GROUPS).toContain(e.group)
  })

  it('plans exactly Azure DevOps, Microsoft Teams and Penpot', () => {
    const planned = INTEGRATION_CATALOG.filter((e) => e.status === 'planned').map((e) => e.kind)
    expect(planned.toSorted()).toEqual(['azure-devops', 'penpot', 'teams'])
    expect(catalogEntry('teams')?.status).toBe('planned')
    // Built integrations live in the registry, not in this list.
    expect(catalogEntry('github')).toBeUndefined()
    expect(catalogEntry('nope')).toBeUndefined()
  })

  it('filters by text and group', () => {
    expect(filterCatalog(INTEGRATION_CATALOG, { query: 'azure' }).map((e) => e.kind)).toEqual([
      'azure-devops',
    ])
    expect(filterCatalog(INTEGRATION_CATALOG, { group: 'chat' }).map((e) => e.kind)).toEqual([
      'teams',
    ])
    expect(filterCatalog(INTEGRATION_CATALOG, { group: 'all' })).toHaveLength(
      INTEGRATION_CATALOG.length,
    )
    expect(filterCatalog(INTEGRATION_CATALOG, { query: 'JIRA', group: 'design' })).toEqual([])
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
