import { describe, expect, it } from 'vitest'

import {
  hubSubtitle,
  type WorkspaceHubFacts,
  workspaceHubGroups,
} from '#features/workspace-settings/hub-model.ts'

const facts = (over: Partial<WorkspaceHubFacts> = {}): WorkspaceHubFacts => ({
  member: true,
  canManage: true,
  slug: 'acme',
  memberCount: 6,
  projectCount: 3,
  storage: '1.5 MB',
  signInMethods: 2,
  integrationCount: 1,
  ...over,
})

const flat = (f: WorkspaceHubFacts) =>
  workspaceHubGroups(f).flatMap((g) => g.rows.map((r) => [g.title, r.label, r.value] as const))

describe('workspaceHubGroups', () => {
  it('lists every page in its group for owners and admins, with its summary', () => {
    expect(flat(facts())).toEqual([
      ['Workspace', 'General', 'acme'],
      ['Workspace', 'Members', '6 members'],
      ['Workspace', 'Projects', '3 projects'],
      ['Access', 'Sign-in and domains', '2 methods'],
      ['Connections', 'Integrations', '1 integration'],
      ['Data', 'Storage and retention', '1.5 MB'],
    ])
  })

  it('says None for nothing, and leaves a summary out while it loads', () => {
    expect(
      flat(facts({ projectCount: 0, signInMethods: 0, integrationCount: undefined })).filter(
        ([, label]) => ['Projects', 'Sign-in and domains', 'Integrations'].includes(label),
      ),
    ).toEqual([
      ['Workspace', 'Projects', 'None'],
      ['Access', 'Sign-in and domains', 'None'],
      ['Connections', 'Integrations', undefined],
    ])
  })

  it('gives a plain member Members and Projects only, and drops the empty groups', () => {
    const groups = workspaceHubGroups(facts({ canManage: false }))
    expect(groups.map((g) => g.title)).toEqual(['Workspace'])
    expect(groups[0]?.rows.map((r) => r.label)).toEqual(['Members', 'Projects'])
  })

  it('has no rows for someone who is not in the workspace', () => {
    expect(workspaceHubGroups(facts({ member: false, canManage: undefined }))).toEqual([])
  })

  it('has the one-member and one-project wording', () => {
    expect(hubSubtitle(1, 1)).toBe('1 member · 1 project')
    expect(hubSubtitle(6, 0)).toBe('6 members · 0 projects')
  })
})
