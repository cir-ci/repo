import { seedBuild } from '@circi/testing'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { db, acme, get } = fx
afterAll(() => fx.close())

// The fixture's `web` team has builds 1 and 2. Add builds so the orders differ, with ties.
const at = (n: number) => new Date(Date.UTC(2031, 0, 1, 0, 0, n))
const changed = (n: number, createdAt: Date, review: 'pending' | 'approved' = 'pending') =>
  seedBuild(db, acme.team.id, {
    createdAt,
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: review,
    changedSnapshots: Array.from({ length: n }, (_, i) => `s${i}`),
  })
await changed(1, at(1))
const b4 = await changed(4, at(1)) // same time as 3
const b5 = await changed(2, at(2), 'approved')
const b6 = await changed(4, at(2))

const teamUrl = (query: string) => `/api/teams/${acme.workspaceSlug}/web${query}`
const numbers = (body: { builds: { number: number }[] }) => body.builds.map((b) => b.number)

describe('the order of the builds lists', () => {
  it('orders a team’s list and pages it with the build number', async () => {
    const newest = (await get(teamUrl('?order=newest'))).json()
    expect(numbers(newest).slice(0, 4)).toEqual([6, 5, 4, 3])
    expect(numbers((await get(teamUrl('?order=oldest'))).json()).slice(0, 3)).toEqual([1, 2, 3])
    const most = numbers((await get(teamUrl('?order=most-changes'))).json())
    expect(most.slice(0, 3)).toEqual([b6.number, b4.number, b5.number])
    // The second page of "most changes" picks up after build 4.
    const next = numbers((await get(teamUrl(`?order=most-changes&before=${b4.number}`))).json())
    expect(next[0]).toBe(b5.number)
    expect(next).toEqual(most.slice(2))
    const status = numbers((await get(teamUrl('?order=status'))).json())
    // Waiting for review (6, 4, 3), then approved (5).
    expect(status.slice(0, 4)).toEqual([6, 4, 3, 5])
  })

  it('orders the workspace list, and rejects an unknown order', async () => {
    const url = `/api/workspaces/${acme.workspaceSlug}/builds`
    const oldest = (await get(`${url}?order=oldest`)).json()
    expect(oldest.builds.map((b: { number: number }) => b.number).slice(0, 2)).toEqual([1, 2])
    const most = (await get(`${url}?order=most-changes`)).json()
    expect(
      most.builds
        .slice(0, 2)
        .map((b: { id: string }) => b.id)
        .toSorted(),
    ).toEqual([b4.id, b6.id].toSorted())
    expect((await get(`${url}?order=sideways`)).statusCode).toBe(400)
    expect((await get(teamUrl('?order=sideways'))).statusCode).toBe(400)
  })
})
