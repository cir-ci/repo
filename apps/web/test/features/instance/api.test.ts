import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { noticesQuery } from '../../../src/features/instance/api.ts'
import { fakeFetch, restoreFetch } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

describe('noticesQuery', () => {
  it('reads the instance notices', async () => {
    const notices = {
      publicUrlChange: { from: 'a.test', to: 'b.test', at: '2026-01-01T00:00:00Z', checklist: [] },
    }
    fakeFetch({ 'GET /api/instance/notices': notices })
    expect(await new QueryClient().fetchQuery(noticesQuery())).toEqual(notices)
  })
})
