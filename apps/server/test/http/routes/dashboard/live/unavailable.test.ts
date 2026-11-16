import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard({
  live: {
    listen: async () => {
      throw new Error('no database feed')
    },
  },
})
afterAll(() => fx.close())

describe('GET /api/live without the database feed', () => {
  it('is refused with 503 (the dashboard then polls slowly), not left open and silent', async () => {
    const res = await fx.get('/api/live')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'Live updates are not available right now' })
  })

  it('still asks for a session first', async () => {
    expect((await fx.get('/api/live', '')).statusCode).toBe(401)
  })
})
