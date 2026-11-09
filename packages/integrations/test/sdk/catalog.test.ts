import { INTEGRATION_GROUPS } from '@circi/core'
import { describe, expect, it } from 'vitest'

import { catalogEntry, INTEGRATION_CATALOG } from '#src/sdk/catalog.ts'

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
})
