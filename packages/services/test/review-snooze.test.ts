import { createBuild, listReviewRequests, schema } from '@circi/db'
import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { requestReview, snoozeReviewRequest, unsnoozeReviewRequest } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: reviewer.id })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  const now = new Date('2026-03-10T12:00:00.000Z') // a Tuesday
  const { request } = await requestReview(t.db, {
    buildId: build.id,
    reviewerId: reviewer.id,
    requestedById: owner.id,
    now,
  })
  return { team, owner, reviewer, request, now }
}

const tab = async (userId: string, name: 'for-you' | 'snoozed', now: Date) =>
  (await listReviewRequests(t.db, { userId, tab: name, now })).map((r) => r.id)

describe('snoozeReviewRequest', () => {
  it('hides the request from For you until the snooze ends, then it is back', async () => {
    const { team, reviewer, request, now } = await setup()
    const row = await snoozeReviewRequest(t.db, {
      teamId: team.id,
      requestId: request.id,
      userId: reviewer.id,
      kind: 'tomorrow',
      now,
    })
    expect(row.snoozedUntil).toEqual(new Date('2026-03-11T09:00:00.000Z'))
    expect(row.snoozeKind).toBe('tomorrow')
    expect(await tab(reviewer.id, 'for-you', now)).toEqual([])
    expect(await tab(reviewer.id, 'snoozed', now)).toEqual([request.id])
    const later = new Date('2026-03-11T09:00:01.000Z')
    expect(await tab(reviewer.id, 'for-you', later)).toEqual([request.id])
    expect(await tab(reviewer.id, 'snoozed', later)).toEqual([])
  })

  it('snoozes until a date, and next_push has no end time', async () => {
    const { team, reviewer, request, now } = await setup()
    const date = new Date('2026-03-20T08:00:00.000Z')
    const dated = await snoozeReviewRequest(t.db, {
      teamId: team.id,
      requestId: request.id,
      userId: reviewer.id,
      kind: 'date',
      date,
      now,
    })
    expect(dated.snoozedUntil).toEqual(date)
    const push = await snoozeReviewRequest(t.db, {
      teamId: team.id,
      requestId: request.id,
      userId: reviewer.id,
      kind: 'next_push',
      now,
    })
    expect(push).toMatchObject({ snoozeKind: 'next_push', snoozedUntil: null })
    expect(await tab(reviewer.id, 'snoozed', new Date('2030-01-01'))).toEqual([request.id])
  })

  it('unsnoozes at once', async () => {
    const { team, reviewer, request, now } = await setup()
    const input = { teamId: team.id, requestId: request.id, userId: reviewer.id }
    await snoozeReviewRequest(t.db, { ...input, kind: 'next_week', now })
    const row = await unsnoozeReviewRequest(t.db, input)
    expect(row).toMatchObject({ snoozeKind: null, snoozedUntil: null })
    expect(await tab(reviewer.id, 'for-you', now)).toEqual([request.id])
  })

  it('is the reviewer’s alone, and needs an open request in the team', async () => {
    const { team, owner, reviewer, request, now } = await setup()
    const base = { teamId: team.id, requestId: request.id, kind: 'tomorrow' as const, now }
    await expect(snoozeReviewRequest(t.db, { ...base, userId: owner.id })).rejects.toThrow(
      /not found/,
    )
    const other = await seedTeam(t.db)
    await expect(
      snoozeReviewRequest(t.db, { ...base, teamId: other.team.id, userId: reviewer.id }),
    ).rejects.toThrow(/not found/)
    await expect(
      unsnoozeReviewRequest(t.db, {
        teamId: team.id,
        requestId: request.id,
        userId: owner.id,
      }),
    ).rejects.toThrow(/not found/)
  })

  it('rejects a date in the past', async () => {
    const { team, reviewer, request, now } = await setup()
    await expect(
      snoozeReviewRequest(t.db, {
        teamId: team.id,
        requestId: request.id,
        userId: reviewer.id,
        kind: 'date',
        date: new Date('2026-03-01'),
        now,
      }),
    ).rejects.toThrow(/future/)
  })

  it('ends a next_push snooze when a newer build on the branch supersedes the request', async () => {
    const { team, reviewer, request, now } = await setup()
    await snoozeReviewRequest(t.db, {
      teamId: team.id,
      requestId: request.id,
      userId: reviewer.id,
      kind: 'next_push',
      now,
    })
    // finalizeBuild supersedes the older builds' open requests of the branch (covered in
    // reviews.test.ts); a closed request is in neither tab, snoozed or not.
    await t.db
      .update(schema.reviewRequests)
      .set({ state: 'superseded', closedAt: new Date() })
      .where(eq(schema.reviewRequests.id, request.id))
    expect(await tab(reviewer.id, 'snoozed', now)).toEqual([])
    expect(await tab(reviewer.id, 'for-you', now)).toEqual([])
  })
})
