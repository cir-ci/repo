import { ValidationError } from '@circi/core'
import { listTriage } from '@circi/db/queries'
import { createBuild, markFileVerified, planUploads } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedChangedSnapshots,
  seedReviewRequest,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  changeTeamSettings,
  finalizeBuild,
  notifyOverdueReviews,
  requestReview,
  reviewBuild,
  snoozeTriage,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const requestsOf = async (buildId: string) =>
  t.db
    .select()
    .from(schema.reviewRequests)
    .where(eq(schema.reviewRequests.buildId, buildId))
    .orderBy(asc(schema.reviewRequests.createdAt), asc(schema.reviewRequests.id))

async function teamWithMates() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
  const other = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: other.id })
  return { team, workspace, owner, mate, other }
}

async function pushBuild(teamId: string, branch: string, commit: string, hash: string) {
  const build = await createBuild(t.db, { teamId, commitSha: commit, branch })
  await planUploads(t.db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(t.db, hash, { size: 10 })
  await finalizeBuild(t.db, { buildId: build.id, screenshots: [{ name: 'home', sha256: hash }] })
  return build
}

const notices = async (userId: string, kind: 'review_re_requested' | 'review_overdue') =>
  t.db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)))

async function changedBuild(teamId: string) {
  const build = await seedBuild(t.db, teamId, { branch: 'feature', status: 'complete' })
  await t.db
    .update(schema.builds)
    .set({ conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  await seedChangedSnapshots(t.db, build.id)
  return build
}

async function noChanges(teamId: string) {
  const build = await seedBuild(t.db, teamId, { branch: 'feature', status: 'complete' })
  await t.db
    .update(schema.builds)
    .set({ conclusion: 'no_changes' })
    .where(eq(schema.builds.id, build.id))
  return build
}

describe('team review settings', () => {
  it('start with the behaviour teams had before they were settings', async () => {
    const { team } = await seedTeam(t.db)
    const [row] = await t.db.select().from(schema.teams).where(eq(schema.teams.id, team.id))
    expect(row).toMatchObject({
      closeReviewsOnNewerBuild: true,
      reRequestOnNewerBuild: false,
      autoApproveNoChanges: true,
      requireRejectReason: false,
      flakyAfterChanges: 3,
      snoozeDefaultDays: 7,
      reviewOverdueNotifyUserId: null,
    })
  })

  it('refuse values out of range and a person outside the team', async () => {
    const { team } = await seedTeam(t.db)
    const stranger = await seedUser(t.db)
    await expect(
      changeTeamSettings(t.db, team.id, { flakyAfterChanges: 0 }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      changeTeamSettings(t.db, team.id, { flakyAfterChanges: 11 }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      changeTeamSettings(t.db, team.id, { snoozeDefaultDays: 31 }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      changeTeamSettings(t.db, team.id, { reviewOverdueNotifyUserId: stranger.id }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('closing and re-requesting on a newer build', () => {
  it('keeps the older build open when the team turns closing off', async () => {
    const { team, owner, mate } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { closeReviewsOnNewerBuild: false })
    const older = await pushBuild(team.id, 'feature', 'a000001', fakeSha('1'))
    await requestReview(t.db, { buildId: older.id, reviewerId: mate.id, requestedById: owner.id })
    await pushBuild(team.id, 'feature', 'a000002', fakeSha('2'))
    expect((await requestsOf(older.id)).map((r) => r.state)).toEqual(['open'])
  })

  it('does not ask the same reviewers on the newer build by default', async () => {
    const { team, owner, mate } = await teamWithMates()
    const older = await pushBuild(team.id, 'feature', 'a000001', fakeSha('3'))
    await requestReview(t.db, { buildId: older.id, reviewerId: mate.id, requestedById: owner.id })
    const newer = await pushBuild(team.id, 'feature', 'a000002', fakeSha('4'))
    expect((await requestsOf(older.id)).map((r) => r.state)).toEqual(['superseded'])
    expect(await requestsOf(newer.id)).toEqual([])
  })

  it('asks the same reviewers again on the newer build when the team wants it', async () => {
    const { team, owner, mate, other } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { reRequestOnNewerBuild: true })
    const older = await pushBuild(team.id, 'feature', 'a000001', fakeSha('5'))
    await requestReview(t.db, { buildId: older.id, reviewerId: mate.id, requestedById: owner.id })
    const newer = await pushBuild(team.id, 'feature', 'a000002', fakeSha('6'))
    const asked = await requestsOf(newer.id)
    expect(asked.map((r) => [r.reviewerId, r.state])).toEqual([[mate.id, 'open']])
    // They hear it as a re-request, and nobody else is asked.
    expect(await notices(mate.id, 'review_re_requested')).toHaveLength(1)
    expect(await notices(other.id, 'review_re_requested')).toHaveLength(0)
  })

  it('skips a reviewer who left the team', async () => {
    const { team, owner, mate } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { reRequestOnNewerBuild: true })
    const older = await pushBuild(team.id, 'feature', 'a000001', fakeSha('7'))
    await requestReview(t.db, { buildId: older.id, reviewerId: mate.id, requestedById: owner.id })
    await t.db
      .delete(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, mate.id)))
    const newer = await pushBuild(team.id, 'feature', 'a000002', fakeSha('8'))
    expect(await requestsOf(newer.id)).toEqual([])
  })
})

describe('a reason when rejecting', () => {
  it('is refused without one when the team asks for it, and accepted with one', async () => {
    const { team, owner } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { requireRejectReason: true })
    const build = await changedBuild(team.id)
    await expect(
      reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' }),
    ).rejects.toMatchObject({ fields: { reason: 'Add a reason for rejecting' } })
    await expect(
      reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected', reason: '  ' }),
    ).rejects.toBeInstanceOf(ValidationError)
    const done = await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'Wrong colour',
    })
    expect(done.reviewStatus).toBe('rejected')
  })

  it('never asks for one on approval, or from a team that does not require it', async () => {
    const { team, owner } = await teamWithMates()
    const build = await changedBuild(team.id)
    expect(
      (await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' }))
        .reviewStatus,
    ).toBe('rejected')
    await changeTeamSettings(t.db, team.id, { requireRejectReason: true })
    expect(
      (await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' }))
        .reviewStatus,
    ).toBe('approved')
  })

  it("doesn't hold up a code host's reject button, which has no field for it", async () => {
    const { team, owner } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { requireRejectReason: true })
    const build = await changedBuild(team.id)
    const done = await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      source: 'github-check',
    })
    expect(done.reviewStatus).toBe('rejected')
  })
})

describe('approving builds with no changes', () => {
  it('needs a person when the team turns it off', async () => {
    const { team, owner } = await teamWithMates()
    const build = await noChanges(team.id)
    await expect(
      reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' }),
    ).rejects.toThrow(/no changes/)
    await changeTeamSettings(t.db, team.id, { autoApproveNoChanges: false })
    expect(
      (await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' }))
        .reviewStatus,
    ).toBe('approved')
  })
})

describe('telling someone else when a review is overdue', () => {
  it('tells the person the team named, once, besides the reviewer', async () => {
    const { team, owner, mate, other } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { reviewOverdueNotifyUserId: other.id })
    const build = await seedBuild(t.db, team.id, { branch: 'feature', status: 'complete' })
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: mate.id,
      requestedById: owner.id,
      dueAt: new Date('2026-01-01T00:00:00Z'),
    })
    const now = new Date('2026-01-02T00:00:00Z')
    expect(await notifyOverdueReviews(t.db, { now })).toBe(1)
    expect(await notices(mate.id, 'review_overdue')).toHaveLength(1)
    const copy = await notices(other.id, 'review_overdue')
    expect(copy).toHaveLength(1)
    expect(copy[0]).toMatchObject({
      actorId: mate.id,
      payload: expect.objectContaining({ cc: true }),
    })
    // Once per request: a second sweep tells nobody.
    expect(await notifyOverdueReviews(t.db, { now })).toBe(0)
    expect(await notices(other.id, 'review_overdue')).toHaveLength(1)
  })

  it('sends the reviewer one notice when they are the named person', async () => {
    const { team, owner, mate } = await teamWithMates()
    await changeTeamSettings(t.db, team.id, { reviewOverdueNotifyUserId: mate.id })
    const build = await seedBuild(t.db, team.id, { branch: 'feature', status: 'complete' })
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: mate.id,
      requestedById: owner.id,
      dueAt: new Date('2026-01-01T00:00:00Z'),
    })
    await notifyOverdueReviews(t.db, { now: new Date('2026-01-02T00:00:00Z') })
    expect(await notices(mate.id, 'review_overdue')).toHaveLength(1)
  })
})

describe('the snooze default', () => {
  it("lasts the team's days when no date is given", async () => {
    const { team } = await seedTeam(t.db)
    const failed = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
    const ref = { teamId: team.id, kind: 'failed' as const, key: `build:${failed.number}` }
    const now = new Date('2026-03-10T12:00:00Z')
    await changeTeamSettings(t.db, team.id, { snoozeDefaultDays: 3 })
    const { until, item } = await snoozeTriage(t.db, { ...ref, now })
    expect(until).toEqual(new Date('2026-03-13T12:00:00Z'))
    expect(item.snoozeKind).toBe('date')
    // Out of the queue until then, back after.
    const at = (iso: string) => listTriage(t.db, { teamId: team.id, now: new Date(iso) })
    expect((await at('2026-03-12T00:00:00Z')).items[0]?.snoozed).toBe(true)
    expect((await at('2026-03-14T00:00:00Z')).items[0]?.snoozed).toBe(false)
  })

  it('is a week for a team that never changed it, and an explicit date still wins', async () => {
    const { team } = await seedTeam(t.db)
    const failed = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
    const ref = { teamId: team.id, kind: 'failed' as const, key: `build:${failed.number}` }
    const now = new Date('2026-03-10T12:00:00Z')
    expect((await snoozeTriage(t.db, { ...ref, choice: 'date', now })).until).toEqual(
      new Date('2026-03-17T12:00:00Z'),
    )
    const date = new Date('2026-03-20T09:00:00Z')
    expect((await snoozeTriage(t.db, { ...ref, choice: 'date', date, now })).until).toEqual(date)
  })
})
