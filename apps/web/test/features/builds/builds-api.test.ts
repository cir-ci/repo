import type { Build } from '@circi/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { buildQuery, fileUrl, isActive } from '#features/builds/api.ts'
import { teamQuery } from '#features/teams/api.ts'

const interval = (options: { refetchInterval?: unknown }, data: unknown) => {
  const fn = options.refetchInterval
  if (typeof fn !== 'function') return fn
  const query = new QueryClient().getQueryCache().build(new QueryClient(), {
    queryKey: ['x'],
    queryFn: () => data,
  })
  query.setData(data)
  return fn(query)
}

const detail = (status: Build.Detail['build']['status']) => ({ build: { status } })
const list = (...statuses: string[]) => ({ builds: statuses.map((status) => ({ status })) })

describe('isActive', () => {
  it.each(['pending', 'uploading', 'processing'])('%s builds are still moving', (s) => {
    expect(isActive(s)).toBe(true)
  })
  it.each(['complete', 'error', 'expired'])('%s builds are done', (s) => {
    expect(isActive(s)).toBe(false)
  })
})

describe('query options', () => {
  it('polls a build page only while the build is active', () => {
    expect(interval(buildQuery('a', 'b', 1), detail('processing'))).toBe(2_000)
    expect(interval(buildQuery('a', 'b', 1), detail('complete'))).toBe(false)
  })

  it('polls the builds list while any build is active', () => {
    expect(interval(teamQuery('a', 'b'), list('complete', 'processing'))).toBe(3_000)
    expect(interval(teamQuery('a', 'b'), list('complete', 'error'))).toBe(false)
  })

  it('escapes path segments and keys builds per page', () => {
    expect(teamQuery('a b', 'c/d', 5).queryKey).toEqual(['team', 'a b', 'c/d', 5])
    expect(fileUrl('abc')).toBe('/api/files/abc')
  })
})
