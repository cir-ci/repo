import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { changesCell } from '#features/teams/list.ts'

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
