import { describe, expect, it } from 'vitest'

import {
  filterRepositories,
  importLabel,
  type Repository,
  repositoryKey,
} from '#features/teams/github-import.ts'

const repo = (ref: string, integration = 'i1'): Repository => ({
  integration,
  installation: 'Installation 1',
  ref,
  private: false,
})

describe('filterRepositories', () => {
  const all = [repo('acme/web-app'), repo('acme/design-system'), repo('other/web-docs')]

  it('keeps everything for an empty search', () => {
    expect(filterRepositories(all, '  ')).toEqual(all)
  })

  it('needs every word, in any case, anywhere in owner/name', () => {
    expect(filterRepositories(all, 'WEB').map((r) => r.ref)).toEqual([
      'acme/web-app',
      'other/web-docs',
    ])
    expect(filterRepositories(all, 'acme web').map((r) => r.ref)).toEqual(['acme/web-app'])
    expect(filterRepositories(all, 'zzz')).toEqual([])
  })
})

describe('the import button and keys', () => {
  it('counts the teams that will be made', () => {
    expect(importLabel(0)).toBe('Import')
    expect(importLabel(1)).toBe('Import 1 team')
    expect(importLabel(3)).toBe('Import 3 teams')
  })

  it('tells the same repository of two installations apart', () => {
    expect(repositoryKey(repo('a/b', 'i1'))).not.toBe(repositoryKey(repo('a/b', 'i2')))
  })
})
