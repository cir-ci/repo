import { describe, expect, it } from 'vitest'

import { hubGroups, type HubFacts } from '#features/project-settings/hub-model.ts'

const facts = (over: Partial<HubFacts> = {}): HubFacts => ({
  canManage: true,
  memberCount: 4,
  ruleCount: 2,
  regionCount: 1,
  webhookCount: 0,
  siteCount: 3,
  ...over,
})

const flat = (f: HubFacts) =>
  hubGroups(f).flatMap((g) => g.rows.map((r) => [r.label, r.value] as const))

describe('hubGroups', () => {
  it('lists every page of a project for people who manage it, with its summary', () => {
    expect(flat(facts())).toEqual([
      ['General', undefined],
      ['Members', '4 members'],
      ['CI token', undefined],
      ['Reviews and triage', '2 rules'],
      ['Ignore regions', '1 region'],
      ['Webhooks', 'None'],
      ['Sites', '3 sites'],
    ])
  })

  it('leaves out the pages and the empty groups members have no use for', () => {
    const groups = hubGroups(facts({ canManage: false }))
    expect(groups.map((g) => g.title)).toEqual(['Project', 'Reviews'])
    expect(flat(facts({ canManage: false })).map(([label]) => label)).toEqual([
      'Members',
      'Ignore regions',
    ])
  })

  it('says No rules and None for nothing, and nothing while a number loads', () => {
    expect(
      flat(facts({ ruleCount: 0, regionCount: 0, memberCount: 1 })).filter(([, v]) => v),
    ).toEqual([
      ['Members', '1 member'],
      ['Reviews and triage', 'No rules'],
      ['Ignore regions', 'None'],
      ['Webhooks', 'None'],
      ['Sites', '3 sites'],
    ])
    const loading = flat(
      facts({
        memberCount: undefined,
        ruleCount: undefined,
        regionCount: undefined,
        siteCount: undefined,
        webhookCount: undefined,
      }),
    )
    expect(loading.every(([, value]) => value === undefined)).toBe(true)
  })
})
