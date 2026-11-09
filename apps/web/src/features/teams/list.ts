import type { Build } from '@circi/api'

import { buildState } from '#features/builds/build-state.ts'

/** What the Changes column of the Teams list says about a team's latest build. */
export type ChangesCell =
  | { kind: 'text'; text: string }
  | { kind: 'counts'; counts: { glyph: string; count: number; title: string }[] }

const PARTS = [
  ['changed', '~'],
  ['added', '+'],
  ['removed', '−'],
  ['failed', '!'],
] as const

/** Compact counts ("~4 +1"), or the word for a build with nothing to count yet or no changes. */
export function changesCell(build: Build.ListItem): ChangesCell {
  const state = buildState(build)
  if (state.kind === 'uploading' || state.kind === 'processing')
    return { kind: 'text', text: 'Processing…' }
  if (state.kind === 'failed') return { kind: 'text', text: 'Failed' }
  if (state.kind === 'expired') return { kind: 'text', text: 'Expired' }
  const counts = PARTS.filter(([key]) => build.counts[key] > 0).map(([key, glyph]) => ({
    glyph,
    count: build.counts[key],
    title: `${build.counts[key]} ${key}`,
  }))
  return counts.length === 0 ? { kind: 'text', text: 'No changes' } : { kind: 'counts', counts }
}
