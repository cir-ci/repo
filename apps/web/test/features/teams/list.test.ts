import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { changesCell, groupByWorkspace } from '#features/teams/list.ts'
import { overview } from '#test/support/fixtures.ts'

const BASE: Build.ListItem = {
  id: 'b',
  number: 1,
  name: 'default',
  commitSha: 'abcdef1',
  branch: 'main',
  prNumber: null,
  status: 'complete',
  conclusion: 'changes_detected',
  reviewStatus: 'pending',
  createdAt: '2026-11-08T10:00:00.000Z',
  author: null,
  counts: { total: 5, changed: 0, added: 0, removed: 0, failed: 0, unchanged: 5 },
}

const build = (over: Partial<Build.ListItem> = {}, counts: Partial<Build.Counts> = {}) => ({
  ...BASE,
  ...over,
  counts: { ...BASE.counts, ...counts },
})

describe('changesCell', () => {
  it('says Processing… while the build is not done', () => {
    expect(changesCell(build({ status: 'processing' }))).toEqual({
      kind: 'text',
      text: 'Processing…',
    })
  })

  it('says No changes when there is nothing to count', () => {
    expect(changesCell(build({ conclusion: 'no_changes', reviewStatus: 'approved' }))).toEqual({
      kind: 'text',
      text: 'No changes',
    })
  })

  it('counts changed, added, removed and failed compactly', () => {
    const cell = changesCell(build({}, { changed: 4, added: 1 }))
    expect(cell).toEqual({
      kind: 'counts',
      counts: [
        { glyph: '~', count: 4, title: '4 changed' },
        { glyph: '+', count: 1, title: '1 added' },
      ],
    })
  })
})

describe('groupByWorkspace', () => {
  it('makes one group per workspace, workspaces A to Z, each keeping its teams in order', () => {
    const groups = groupByWorkspace([
      overview('globex', 'portal'),
      overview('acme', 'web'),
      overview('globex', 'admin'),
      overview('acme', 'api'),
    ])
    expect(groups.map((g) => [g.workspace.slug, g.teams.map((t) => t.team.slug)])).toEqual([
      ['acme', ['web', 'api']],
      ['globex', ['portal', 'admin']],
    ])
  })

  it('makes one group for one workspace and none for no teams', () => {
    expect(groupByWorkspace([overview('acme', 'web')])).toHaveLength(1)
    expect(groupByWorkspace([])).toEqual([])
  })
})
