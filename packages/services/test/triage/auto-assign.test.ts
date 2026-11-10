import { listTriage } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb, seedBuild, seedTeam, seedUser } from '@circi/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assignTriage,
  autoAssignAllTeams,
  autoAssignTriage,
  changeTeamSettings,
  dismissTriage,
  failBuild,
  replaceTriageRotation,
  snoozeTriage,
  updateWorkspaceSettings,
} from '#src/index.ts'

let t: createTestDb.Result
// A database each: the sweep looks at every team, so teams of other tests would change its counts.
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.close()
})

const WEEK = 7 * 24 * 3600_000

/**
 * A team whose default branch has two failed builds (two triage items), with the owner and a
 * teammate in a rotation that starts this week: the owner is on triage now, the teammate next week.
 */
async function setup(options: { rotation?: boolean } = {}) {
  const { team, workspace, owner } = await seedTeam(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
  const first = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
  const second = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
  const startsOn = new Date()
  if (options.rotation !== false) {
    await replaceTriageRotation(t.db, { teamId: team.id, memberIds: [owner.id, mate.id], startsOn })
  }
  const nextWeek = new Date(startsOn.getTime() + WEEK)
  const queue = async (now = startsOn) => (await listTriage(t.db, { teamId: team.id, now })).items
  const ref = (build: { number: number }) => ({
    teamId: team.id,
    kind: 'failed',
    key: `build:${build.number}`,
  })
  const assigned = async (now = startsOn) =>
    Object.fromEntries(
      (await queue(now)).map((i) => [i.key, i.assignee ? [i.assignee.id, i.assignee.auto] : null]),
    )
  const notices = (userId: string) =>
    t.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.kind, 'triage_assigned'),
        ),
      )
  return {
    team,
    workspace,
    owner,
    mate,
    first,
    second,
    startsOn,
    nextWeek,
    queue,
    ref,
    assigned,
    notices,
  }
}

const keyOf = (build: { number: number }) => `build:${build.number}`

describe('the setting', () => {
  it('assigns nothing while it is off (the default)', async () => {
    const { team, queue } = await setup()
    expect(await autoAssignTriage(t.db, { teamId: team.id })).toBe(0)
    expect((await queue()).map((i) => i.assignee)).toEqual([null, null])
  })

  it('turned on for the team, gives the waiting items to whoever is on triage and tells them', async () => {
    const { team, owner, first, second, assigned, notices } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    expect(await assigned()).toEqual({
      [keyOf(first)]: [owner.id, true],
      [keyOf(second)]: [owner.id, true],
    })
    // The owner is told once, not once per item.
    const [notice, ...rest] = await notices(owner.id)
    expect(rest).toEqual([])
    expect(notice).toMatchObject({ kind: 'triage_assigned', actorId: null })
    expect(notice?.payload).toMatchObject({ count: 2 })
  })

  it('turned on for the workspace, reaches teams that inherit and not teams that override', async () => {
    const { workspace, owner, mate, queue } = await setup()
    const other = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'mobile' })
    await seedBuild(t.db, other.team.id, { branch: 'main', status: 'error' })
    await replaceTriageRotation(t.db, { teamId: other.team.id, memberIds: [mate.id] })
    await changeTeamSettings(t.db, other.team.id, { assignTriageToOnCall: false })
    await updateWorkspaceSettings(t.db, workspace.id, { assignTriageToOnCall: true })
    expect((await queue()).map((i) => i.assignee?.id)).toEqual([owner.id, owner.id])
    const otherQueue = await listTriage(t.db, { teamId: other.team.id, now: new Date() })
    expect(otherQueue.items.map((i) => i.assignee)).toEqual([null])
  })

  it('a team value of null follows the workspace again', async () => {
    const { team, workspace, owner, queue } = await setup()
    await updateWorkspaceSettings(t.db, workspace.id, { assignTriageToOnCall: true })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: false })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: null })
    expect((await queue()).map((i) => i.assignee?.id)).toEqual([owner.id, owner.id])
  })
})

describe('when it runs', () => {
  it('assigns a new item once the build that makes it fails', async () => {
    const { team, owner, notices } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    const before = (await notices(owner.id)).length
    const build = await seedBuild(t.db, team.id, { branch: 'main' })
    await failBuild(t.db, build.id, 'bad png')
    const item = (await listTriage(t.db, { teamId: team.id, now: new Date() })).items.find(
      (i) => i.key === keyOf(build),
    )
    expect(item?.assignee).toMatchObject({ id: owner.id, auto: true })
    expect((await notices(owner.id)).length).toBe(before + 1)
  })

  it('leaves failed builds on other branches alone', async () => {
    const { team } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    const build = await seedBuild(t.db, team.id, { branch: 'feature' })
    await failBuild(t.db, build.id, 'bad png')
    const rows = await t.db
      .select()
      .from(schema.triageItems)
      .where(eq(schema.triageItems.teamId, team.id))
    expect(rows.map((r) => r.key).toSorted()).not.toContain(keyOf(build))
  })

  it('the handover moves automatic assignments to the new person and leaves a person’s choice', async () => {
    const { team, owner, mate, first, second, ref, assigned, nextWeek } = await setup()
    await assignTriage(t.db, { ...ref(second), assigneeId: owner.id })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    expect(await assigned()).toEqual({
      [keyOf(first)]: [owner.id, true],
      [keyOf(second)]: [owner.id, false],
    })
    // The worker's sweep, a week on.
    expect(await autoAssignAllTeams(t.db, { now: nextWeek })).toBe(1)
    expect(await assigned(nextWeek)).toEqual({
      [keyOf(first)]: [mate.id, true],
      [keyOf(second)]: [owner.id, false],
    })
    // Nothing more to do, nobody is told again.
    expect(await autoAssignAllTeams(t.db, { now: nextWeek })).toBe(0)
  })

  it('replacing the rotation hands automatic assignments to whoever is on triage now', async () => {
    const { team, mate, first, second, assigned } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    await replaceTriageRotation(t.db, { teamId: team.id, memberIds: [mate.id] })
    expect(await assigned()).toEqual({
      [keyOf(first)]: [mate.id, true],
      [keyOf(second)]: [mate.id, true],
    })
  })
})

describe('never overriding a person', () => {
  it('an item somebody unassigned stays unassigned, through new builds and the handover', async () => {
    const { team, first, second, ref, assigned, nextWeek } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    await assignTriage(t.db, { ...ref(first), assigneeId: null })
    await autoAssignTriage(t.db, { teamId: team.id })
    await autoAssignAllTeams(t.db, { now: nextWeek })
    const failedAgain = await seedBuild(t.db, team.id, { branch: 'main' })
    await failBuild(t.db, failedAgain.id, 'x')
    const now = await assigned(nextWeek)
    expect(now[keyOf(first)]).toBeNull()
    expect(now[keyOf(second)]?.[1]).toBe(true)
  })

  it('an item somebody assigned to themselves does not move', async () => {
    const { team, mate, first, ref, assigned, nextWeek } = await setup()
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    await assignTriage(t.db, { ...ref(first), assigneeId: mate.id })
    await autoAssignAllTeams(t.db, { now: nextWeek })
    expect((await assigned(nextWeek))[keyOf(first)]).toEqual([mate.id, false])
  })

  it('an item assigned before the setting existed counts as a person’s choice', async () => {
    const { team, mate, first, assigned, nextWeek } = await setup()
    await t.db
      .insert(schema.triageItems)
      .values({ teamId: team.id, kind: 'failed', key: keyOf(first), assigneeId: mate.id })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    await autoAssignAllTeams(t.db, { now: nextWeek })
    expect((await assigned(nextWeek))[keyOf(first)]).toEqual([mate.id, false])
  })

  it('a dismissed item is left out of the queue and not assigned', async () => {
    const { team, first, ref } = await setup()
    await dismissTriage(t.db, ref(first))
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    const [row] = await t.db
      .select()
      .from(schema.triageItems)
      .where(and(eq(schema.triageItems.teamId, team.id), eq(schema.triageItems.key, keyOf(first))))
    expect(row?.assigneeId).toBeNull()
  })
})

describe('what it skips', () => {
  it('snoozed items stay unassigned', async () => {
    const { team, first, second, ref, assigned } = await setup()
    await snoozeTriage(t.db, { ...ref(first), choice: 'next_week', now: new Date() })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    const items = await assigned()
    expect(items[keyOf(first)]).toBeNull()
    expect(items[keyOf(second)]?.[1]).toBe(true)
  })

  it('does nothing without a rotation', async () => {
    const { team, queue, owner } = await setup({ rotation: false })
    await changeTeamSettings(t.db, team.id, { assignTriageToOnCall: true })
    expect(await autoAssignTriage(t.db, { teamId: team.id })).toBe(0)
    expect(await autoAssignAllTeams(t.db)).toBeGreaterThanOrEqual(0)
    expect((await queue()).map((i) => i.assignee)).toEqual([null, null])
    expect(
      (await t.db.select().from(schema.notifications)).filter((n) => n.userId === owner.id),
    ).toEqual([])
  })
})
