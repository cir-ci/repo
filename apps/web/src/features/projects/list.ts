import type { Build, Project } from '@circi/api'

import { buildState } from '#features/builds/build-state.ts'

/** What the Changes column of the Projects list says about a project's latest build. */
export type ChangesCell =
  | { kind: 'text'; text: string }
  | { kind: 'counts'; counts: { glyph: string; count: number; title: string }[] }

const PARTS = [
  ['changed', '~'],
  ['added', '+'],
  ['removed', '−'],
  ['failed', '!'],
] as const

/** Counts with their noun ("4 changed", "1 added"), or the word for a build with nothing to count yet or no changes. */
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

/** One workspace's projects on the Projects page. */
export interface WorkspaceGroup {
  workspace: Project.Overview['workspace']
  projects: Project.Overview[]
}

/**
 * The projects grouped by workspace, workspaces A to Z by name; each keeps its projects in the order
 * given. One group when the person belongs to one workspace (the page then shows no group header).
 */
export function groupByWorkspace(projects: readonly Project.Overview[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>()
  for (const item of projects) {
    const group = groups.get(item.workspace.slug)
    if (group) group.projects.push(item)
    else groups.set(item.workspace.slug, { workspace: item.workspace, projects: [item] })
  }
  return [...groups.values()].toSorted((a, b) => a.workspace.name.localeCompare(b.workspace.name))
}
