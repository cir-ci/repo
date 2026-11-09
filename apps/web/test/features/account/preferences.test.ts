import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { preferencesQuery } from '#features/account/api.ts'

afterEach(() => vi.unstubAllGlobals())

describe('preferences query', () => {
  it('reads the preferences', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      expect(path).toBe('/api/inbox/preferences')
      return Response.json({ emailReviewRequested: true, emailReviewOverdue: false })
    })
    const data = await new QueryClient().fetchQuery(preferencesQuery())
    expect(data.emailReviewOverdue).toBe(false)
  })
})
