import { describe, expect, it } from 'vitest'

import {
  filterCatalog,
  groupItems,
  isGroupFilter,
  integrationLabel,
  projectCountLabel,
  unavailableNote,
} from '#features/integrations/api.ts'

import { CATALOG, entry, item } from './fixtures.ts'

describe('groupItems', () => {
  it('orders groups as the canvas does, keeps order within a group and drops empty groups', () => {
    const groups = groupItems([
      item({ kind: 'figma', group: 'design', id: 'f' }),
      item({ kind: 'slack', group: 'chat', id: 's' }),
      item({ kind: 'github', group: 'git', id: 'g1' }),
      item({ kind: 'gitlab', group: 'git', id: 'g2' }),
    ])
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Git hosts', ['g1', 'g2']],
      ['Chat', ['s']],
      ['Design tools', ['f']],
    ])
    expect(groupItems([])).toEqual([])
  })
})

describe('filterCatalog', () => {
  it('matches name, kind and description, ignoring case and padding', () => {
    expect(filterCatalog(CATALOG, { query: ' LAB ', group: 'all' }).map((e) => e.kind)).toEqual([
      'gitlab',
    ])
    expect(filterCatalog(CATALOG, { query: 'azure-devops', group: 'all' })).toHaveLength(1)
    expect(filterCatalog(CATALOG, { query: 'figma description', group: 'all' })).toHaveLength(1)
    expect(filterCatalog(CATALOG, { query: '', group: 'all' })).toHaveLength(CATALOG.length)
  })

  it('narrows by group, and by both', () => {
    expect(filterCatalog(CATALOG, { query: '', group: 'chat' }).map((e) => e.kind)).toEqual([
      'slack',
      'teams',
    ])
    expect(filterCatalog(CATALOG, { query: 'git', group: 'chat' })).toEqual([])
    expect(isGroupFilter('design')).toBe(true)
    expect(isGroupFilter('all')).toBe(true)
    expect(isGroupFilter('nope')).toBe(false)
  })
})

describe('unavailableNote', () => {
  it('says why a tile cannot be picked', () => {
    expect(unavailableNote(entry({ kind: 'x', name: 'X' }))).toBeNull()
    expect(unavailableNote(entry({ kind: 'x', name: 'X', status: 'planned' }))).toBe('Planned')
    expect(unavailableNote(entry({ kind: 'x', name: 'X', built: false, connectable: false }))).toBe(
      'Coming soon',
    )
    expect(unavailableNote(entry({ kind: 'x', name: 'X', connectable: false }))).toBe(
      'Not set up on this server',
    )
  })
})

describe('small helpers', () => {
  it('names an integration by its provider and account', () => {
    expect(integrationLabel({ kindName: 'GitHub', name: 'Installation 501' })).toBe(
      'GitHub (Installation 501)',
    )
    expect(integrationLabel({ kindName: 'Mystery', name: 'X' })).toBe('Mystery (X)')
  })
  it('names the project count', () => {
    expect([0, 1, 3].map(projectCountLabel)).toEqual(['No projects yet', '1 project', '3 projects'])
  })
})
