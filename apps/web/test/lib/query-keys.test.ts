import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { invalidateAll, keys } from '#lib/query-keys.ts'

describe('keys', () => {
  it('keeps the tuples the queries were always cached under', () => {
    expect(keys.project('w', 't')).toEqual(['project', 'w', 't'])
    expect(keys.project('w', 't', null, 'q', 'oldest')).toEqual([
      'project',
      'w',
      't',
      null,
      'q',
      'oldest',
    ])
    expect(keys.workspaceBuilds('w', 'b1')).toEqual(['workspace-builds', 'w', 'b1'])
    expect(keys.build('w', 't', 7)).toEqual(['build', 'w', 't', 7])
    expect(keys.projectsettings('w', 't')).toEqual(['settings', 'w', 't'])
    expect(keys.rules('w', 't')).toEqual(['rules', 'w', 't'])
    expect(keys.sites('w', 't')).toEqual(['project-sites', 'w', 't'])
    expect(keys.integrations('w', 'links', 'i', 't')).toEqual([
      'integrations',
      'w',
      'links',
      'i',
      't',
    ])
    expect(keys.insights('w', null, 'a', 'b')).toEqual(['insights', 'w', null, 'a', 'b'])
    expect(keys.instanceHealth('queues')).toEqual(['instance-health', 'queues'])
  })

  it('returns a prefix when the narrowing arguments are left out', () => {
    expect(keys.sidebar()).toEqual(['sidebar'])
    expect(keys.sidebar('w')).toEqual(['sidebar', 'w'])
    expect(keys.triage()).toEqual(['triage'])
    expect(keys.triage('w', 't')).toEqual(['triage', 'w', 't'])
    expect(keys.reviews()).toEqual(['reviews'])
    expect(keys.reviews('open')).toEqual(['reviews', 'open'])
    expect(keys.inbox('unread')).toEqual(['inbox', 'unread'])
    expect(keys.instanceAccounts()).toEqual(['instance-accounts'])
    expect(keys.instanceHealth()).toEqual(['instance-health'])
  })

  it('makes a prefix match the full key in the query client', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(keys.project('w', 't', null), 1)
    queryClient.setQueryData(keys.project('w', 'other'), 2)
    expect(queryClient.getQueryCache().findAll({ queryKey: keys.project('w', 't') })).toHaveLength(
      1,
    )
  })
})

describe('invalidateAll', () => {
  it('invalidates every key and resolves once all have', async () => {
    const queryClient = new QueryClient()
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    await invalidateAll(queryClient, keys.projects(), keys.sidebar('w'))
    expect(spy.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ['projects'] },
      { queryKey: ['sidebar', 'w'] },
    ])
  })
})
