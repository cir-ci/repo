import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedDiff,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countOpenTriage, listTriage } from '#src/queries/index.ts'
import { dismissTriageItem, setTriageRotation } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-11T12:00:00Z')

async function mainBuild(
  teamId: string,
  options: { status?: 'complete' | 'error'; baselineSource?: 'none' | 'cli'; branch?: string } = {},
) {
  const build = await seedBuild(t.db, teamId, {
    branch: options.branch ?? 'main',
    status: options.status ?? 'complete',
  })
  if (options.baselineSource) {
    await t.db
      .update(schema.builds)
      .set({ baselineSource: options.baselineSource })
      .where(eq(schema.builds.id, build.id))
  }
  return build
}

describe('listTriage', () => {
  it('is empty for a team with nothing wrong', async () => {
    const { team } = await seedTeam(t.db)
    const b = await mainBuild(team.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: b.id, name: 'home', status: 'unchanged' })
    expect(await listTriage(t.db, { teamId: team.id, now })).toEqual({
      items: [],
      rotation: { members: [], onTriage: null, until: null },
    })
  })

  it('lists flaky, no-baseline and failed items, each with its build', async () => {
    const { team } = await seedTeam(t.db)
    // Orphan: the first build had nothing to compare with.
    const first = await mainBuild(team.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'pricing', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    // Flaky: `home` changes in three of the next builds.
    const history = []
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(team.id, { baselineSource: 'cli' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: b.id, name: 'home', status: 'changed' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: b.id, name: 'about', status: 'unchanged' })
      history.push(b)
    }
    // Failed: the newest main build errored. A branch build that errored is not triage's business.
    const failed = await mainBuild(team.id, { status: 'error' })
    await mainBuild(team.id, { status: 'error', branch: 'feature' })

    const { items } = await listTriage(t.db, { teamId: team.id, now })
    expect(items.map((i) => [i.kind, i.key, i.snapshotName, i.build.number])).toEqual([
      ['flaky', 'home', 'home', history[2]?.number],
      // `home` was seen again by later builds, so only `pricing` still has no baseline.
      ['no_baseline', 'pricing', 'pricing', first.number],
      ['failed', `build:${failed.number}`, null, failed.number],
    ])
    expect(items[0]).toMatchObject({
      team: { slug: team.slug, name: team.name },
      build: { branch: 'main', status: 'complete' },
      assignee: null,
      snoozedUntil: null,
      snoozed: false,
    })
  })

  it('drops a failed build once a later build completes, and an orphan once it is compared', async () => {
    const { team } = await seedTeam(t.db)
    const first = await mainBuild(team.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    await mainBuild(team.id, { status: 'error' })
    expect((await listTriage(t.db, { teamId: team.id, now })).items).toHaveLength(2)
    const next = await mainBuild(team.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: next.id, name: 'home', status: 'unchanged' })
    expect((await listTriage(t.db, { teamId: team.id, now })).items).toEqual([])
  })

  it('leaves dismissed items out and marks snoozed ones', async () => {
    const { team } = await seedTeam(t.db)
    const a = await mainBuild(team.id, { status: 'error' })
    const first = await mainBuild(team.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'about', status: 'added' })
    await dismissTriageItem(t.db, { teamId: team.id, kind: 'no_baseline', key: 'about' })
    const until = new Date('2026-03-12T09:00:00Z')
    await t.db.insert(schema.triageItems).values({
      teamId: team.id,
      kind: 'no_baseline',
      key: 'home',
      snoozeKind: 'tomorrow',
      snoozedUntil: until,
    })
    const { items } = await listTriage(t.db, { teamId: team.id, now })
    // `a` is older than the completed orphan build, so it is no longer failing either.
    expect(a.number).toBeLessThan(first.number)
    expect(items.map((i) => [i.key, i.snoozed, i.snoozedUntil])).toEqual([['home', true, until]])
  })

  it('names the assignee, and who is on triage this week', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
    const failed = await mainBuild(team.id, { status: 'error' })
    await t.db.insert(schema.triageItems).values({
      teamId: team.id,
      kind: 'failed',
      key: `build:${failed.number}`,
      assigneeId: mate.id,
    })
    await setTriageRotation(t.db, {
      teamId: team.id,
      memberIds: [owner.id, mate.id],
      startsOn: new Date('2026-03-02T00:00:00Z'),
    })
    const queue = await listTriage(t.db, { teamId: team.id, now })
    expect(queue.items[0]?.assignee).toEqual({ id: mate.id, name: mate.name })
    // Weeks from 2026-03-02: 03-09 is the second, so `mate` has this one.
    expect(queue.rotation.onTriage).toEqual({ id: mate.id, name: mate.name })
    expect(queue.rotation.until?.toISOString()).toBe('2026-03-16T00:00:00.000Z')
    expect(queue.rotation.members.map((m) => m.id)).toEqual([owner.id, mate.id])
  })
})

describe('countOpenTriage', () => {
  it('equals the open items of listTriage for every team of the workspace, in one query', async () => {
    const first = await seedTeam(t.db, { slug: 'busy' })
    const { workspace, owner } = first
    const calm = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'calm' })
    const snoozy = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'snoozy' })
    const empty = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'empty' })
    const outside = await seedTeam(t.db)

    // busy: orphans (one dismissed), flaky `home`, a failed build, an errored build that a
    // later complete build supersedes.
    const orphan = await mainBuild(first.team.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: orphan.id, name: 'pricing', status: 'added' })
    await seedDiff(t.db, { buildId: orphan.id, name: 'docs', status: 'added' })
    await dismissTriageItem(t.db, { teamId: first.team.id, kind: 'no_baseline', key: 'docs' })
    await mainBuild(first.team.id, { status: 'error' })
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(first.team.id, { baselineSource: 'cli' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: b.id, name: 'home', status: 'changed' })
    }
    await mainBuild(first.team.id, { status: 'error' })
    await mainBuild(first.team.id, { status: 'error', branch: 'feature' })

    // snoozy: a failed build snoozed until next push, an orphan snoozed until a future time,
    // an orphan whose snooze has ended, and a failure snoozed until a push that then happened.
    const s1 = await mainBuild(snoozy.team.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: s1.id, name: 'a', status: 'added' })
    await seedDiff(t.db, { buildId: s1.id, name: 'b', status: 'added' })
    await seedDiff(t.db, { buildId: s1.id, name: 'c', status: 'added' })
    const failing = await mainBuild(snoozy.team.id, { status: 'error' })
    // The failed build is newer than the orphan build, so it is not superseded.
    await t.db.insert(schema.triageItems).values([
      {
        teamId: snoozy.team.id,
        kind: 'failed',
        key: `build:${failing.number}`,
        snoozeKind: 'next_push',
        snoozedAfterBuild: failing.number,
      },
      {
        teamId: snoozy.team.id,
        kind: 'no_baseline',
        key: 'a',
        snoozeKind: 'tomorrow',
        snoozedUntil: new Date('2026-03-12T09:00:00Z'),
      },
      {
        teamId: snoozy.team.id,
        kind: 'no_baseline',
        key: 'b',
        snoozeKind: 'tomorrow',
        snoozedUntil: new Date('2026-03-10T09:00:00Z'),
      },
      {
        teamId: snoozy.team.id,
        kind: 'no_baseline',
        key: 'c',
        snoozeKind: 'next_push',
        snoozedAfterBuild: failing.number - 1,
      },
    ])

    // calm: clean. empty: no builds. outside: another workspace, must not appear.
    const ok = await mainBuild(calm.team.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: ok.id, name: 'home', status: 'unchanged' })
    await mainBuild(outside.team.id, { status: 'error' })

    const counts = await countOpenTriage(t.db, { workspaceId: workspace.id, now })
    const expected = new Map<string, number>()
    for (const team of [first, calm, snoozy, empty]) {
      // oxlint-disable-next-line no-await-in-loop -- the oracle: one list per team
      const queue = await listTriage(t.db, { teamId: team.team.id, now })
      expected.set(team.team.id, queue.items.filter((i) => !i.snoozed).length)
    }
    expect(counts).toEqual(expected)
    // Not vacuous: the busy team has several, the snoozy one some, the quiet ones none.
    expect(counts.get(first.team.id)).toBeGreaterThanOrEqual(3)
    expect(counts.get(snoozy.team.id)).toBeGreaterThanOrEqual(1)
    expect(counts.get(calm.team.id)).toBe(0)
    expect(counts.get(empty.team.id)).toBe(0)
    expect(counts.has(outside.team.id)).toBe(false)
  })
})
