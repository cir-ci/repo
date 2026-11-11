import {
  addTestMember,
  createTestDb,
  imageSha,
  seedBuild,
  seedDiff,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countOpenTriage, listTriage } from '#src/queries/index.ts'
import {
  dismissTriageItem,
  setTriageRotation,
  updateProjectSettings,
} from '#src/repositories/index.ts'
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
  projectId: string,
  options: { status?: 'complete' | 'error'; baselineSource?: 'none' | 'cli'; branch?: string } = {},
) {
  const build = await seedBuild(t.db, projectId, {
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
  it('is empty for a project with nothing wrong', async () => {
    const { project } = await seedProject(t.db)
    const b = await mainBuild(project.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: b.id, name: 'home', status: 'unchanged' })
    expect(await listTriage(t.db, { projectId: project.id, now })).toEqual({
      items: [],
      rotation: { members: [], onTriage: null, until: null },
    })
  })

  it('lists flaky, no-baseline and failed items, each with its build', async () => {
    const { project } = await seedProject(t.db)
    await updateProjectSettings(t.db, project.id, { flakyAfterChanges: 2 })
    // Orphan: the first build had nothing to compare with.
    const first = await mainBuild(project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'pricing', status: 'added' })
    await seedDiff(t.db, {
      buildId: first.id,
      name: 'home',
      status: 'added',
      headSha256: imageSha('A'),
    })
    // Flaky: `home` goes B, A, B in the next builds: two returns to an earlier image.
    const history = []
    for (const image of ['B', 'A', 'B']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(project.id, { baselineSource: 'cli' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, {
        buildId: b.id,
        name: 'home',
        status: 'changed',
        headSha256: imageSha(image),
      })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: b.id, name: 'about', status: 'unchanged' })
      history.push(b)
    }
    // Failed: the newest main build errored. A branch build that errored is not triage's business.
    const failed = await mainBuild(project.id, { status: 'error' })
    await mainBuild(project.id, { status: 'error', branch: 'feature' })

    const { items } = await listTriage(t.db, { projectId: project.id, now })
    expect(items.map((i) => [i.kind, i.key, i.snapshotName, i.build.number])).toEqual([
      ['flaky', 'home', 'home', history[2]?.number],
      // `home` was seen again by later builds, so only `pricing` still has no baseline.
      ['no_baseline', 'pricing', 'pricing', first.number],
      ['failed', `build:${failed.number}`, null, failed.number],
    ])
    expect(items[0]).toMatchObject({
      project: { slug: project.slug, name: project.name },
      build: { branch: 'main', status: 'complete' },
      assignee: null,
      snoozedUntil: null,
      snoozed: false,
    })
  })

  it('gives a flaky item its last builds, a failed one its error, and counts pull requests it blocks', async () => {
    const { project } = await seedProject(t.db)
    await updateProjectSettings(t.db, project.id, { flakyAfterChanges: 2 })
    const history = []
    for (const [i, image] of ['A', 'B', 'A', 'B'].entries()) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(project.id, { baselineSource: 'cli' })
      // `home` goes A, B, A, B and changes in builds 1, 2 and 4 of the four, not in the third.
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, {
        buildId: b.id,
        name: 'home',
        status: i === 2 ? 'unchanged' : 'changed',
        headSha256: imageSha(image),
      })
      history.push(b)
    }
    // Pull request 7: its first build shows `home` changed, its newer one does not (so it doesn't count).
    const pr = (
      number: number,
      status: 'changed' | 'unchanged',
      reviewStatus: 'pending' | 'approved' = 'pending',
    ) =>
      seedBuild(t.db, project.id, {
        branch: `pr-${number}`,
        prNumber: number,
        status: 'complete',
        reviewStatus,
      }).then(async (b) => {
        await seedDiff(t.db, { buildId: b.id, name: 'home', status })
        return b
      })
    await pr(7, 'changed')
    await pr(7, 'unchanged')
    // Pull requests 8 and 9 show it changed and wait for a review; 10's review is done.
    await pr(8, 'changed')
    await pr(9, 'changed')
    await pr(10, 'changed', 'approved')
    const failed = await mainBuild(project.id, { status: 'error' })
    await t.db
      .update(schema.builds)
      .set({ errorMessage: '2 files over the limit' })
      .where(eq(schema.builds.id, failed.id))

    const { items } = await listTriage(t.db, { projectId: project.id, now })
    const flaky = items.find((i) => i.kind === 'flaky')
    expect(flaky?.history).toEqual(history.map((b, i) => ({ number: b.number, changed: i !== 2 })))
    expect(flaky?.blocking).toBe(2)
    expect(flaky?.error).toBeNull()
    const broken = items.find((i) => i.kind === 'failed')
    expect(broken).toMatchObject({ error: '2 files over the limit', history: [], blocking: 0 })
  })

  it('drops a failed build once a later build completes, and an orphan once it is compared', async () => {
    const { project } = await seedProject(t.db)
    const first = await mainBuild(project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    await mainBuild(project.id, { status: 'error' })
    expect((await listTriage(t.db, { projectId: project.id, now })).items).toHaveLength(2)
    const next = await mainBuild(project.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: next.id, name: 'home', status: 'unchanged' })
    expect((await listTriage(t.db, { projectId: project.id, now })).items).toEqual([])
  })

  it("does not list a first build's screenshots once its approval made them baselines", async () => {
    const { project, workspace } = await seedProject(t.db)
    const first = await mainBuild(project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'about', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'pricing', status: 'added' })
    const keys = async () =>
      (await listTriage(t.db, { projectId: project.id, now })).items.map((i) => i.key).toSorted()
    const open = async () => [
      ...(await countOpenTriage(t.db, { workspaceId: workspace.id, now })).values(),
    ]
    expect(await keys()).toEqual(['about', 'home', 'pricing'])
    // `home` accepted on its own, `about` rejected, `pricing` undecided: only `home` is a baseline.
    await t.db.insert(schema.snapshotReviews).values([
      { buildId: first.id, snapshotName: 'home', decision: 'approved', source: 'ui' },
      { buildId: first.id, snapshotName: 'about', decision: 'rejected', source: 'ui' },
    ])
    expect(await keys()).toEqual(['about', 'pricing'])
    expect(await open()).toEqual([2])
    // The whole build approved: `pricing` is a baseline too; the rejected `about` is not.
    await t.db
      .update(schema.builds)
      .set({ reviewStatus: 'approved' })
      .where(eq(schema.builds.id, first.id))
    expect(await keys()).toEqual(['about'])
    expect(await open()).toEqual([1])
  })

  it('leaves dismissed items out and marks snoozed ones', async () => {
    const { project } = await seedProject(t.db)
    const a = await mainBuild(project.id, { status: 'error' })
    const first = await mainBuild(project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'about', status: 'added' })
    await dismissTriageItem(t.db, { projectId: project.id, kind: 'no_baseline', key: 'about' })
    const until = new Date('2026-03-12T09:00:00Z')
    await t.db.insert(schema.triageItems).values({
      projectId: project.id,
      kind: 'no_baseline',
      key: 'home',
      snoozeKind: 'tomorrow',
      snoozedUntil: until,
    })
    const { items } = await listTriage(t.db, { projectId: project.id, now })
    // `a` is older than the completed orphan build, so it is no longer failing either.
    expect(a.number).toBeLessThan(first.number)
    expect(items.map((i) => [i.key, i.snoozed, i.snoozedUntil])).toEqual([['home', true, until]])
  })

  it('names the assignee, and who is on triage this week', async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
    const failed = await mainBuild(project.id, { status: 'error' })
    await t.db.insert(schema.triageItems).values({
      projectId: project.id,
      kind: 'failed',
      key: `build:${failed.number}`,
      assigneeId: mate.id,
    })
    await setTriageRotation(t.db, {
      projectId: project.id,
      memberIds: [owner.id, mate.id],
      startsOn: new Date('2026-03-02T00:00:00Z'),
    })
    const queue = await listTriage(t.db, { projectId: project.id, now })
    expect(queue.items[0]?.assignee).toEqual({
      id: mate.id,
      name: mate.name,
      image: null,
      auto: false,
    })
    // Weeks from 2026-03-02: 03-09 is the second, so `mate` has this one.
    expect(queue.rotation.onTriage).toEqual({ id: mate.id, name: mate.name, image: null })
    expect(queue.rotation.until?.toISOString()).toBe('2026-03-16T00:00:00.000Z')
    expect(queue.rotation.members.map((m) => m.id)).toEqual([owner.id, mate.id])
  })
})

describe('countOpenTriage', () => {
  it('equals the open items of listTriage for every project of the workspace, in one query', async () => {
    const first = await seedProject(t.db, { slug: 'busy' })
    const { workspace, owner } = first
    const calm = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'calm' })
    const snoozy = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'snoozy' })
    const empty = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'empty' })
    const outside = await seedProject(t.db)

    // busy: orphans (one dismissed), flaky `home`, a failed build, an errored build that a
    // later complete build supersedes.
    const orphan = await mainBuild(first.project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: orphan.id, name: 'pricing', status: 'added' })
    await seedDiff(t.db, { buildId: orphan.id, name: 'docs', status: 'added' })
    await dismissTriageItem(t.db, { projectId: first.project.id, kind: 'no_baseline', key: 'docs' })
    await mainBuild(first.project.id, { status: 'error' })
    await updateProjectSettings(t.db, first.project.id, { flakyAfterChanges: 2 })
    for (const image of ['A', 'B', 'A', 'B']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(first.project.id, { baselineSource: 'cli' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, {
        buildId: b.id,
        name: 'home',
        status: 'changed',
        headSha256: imageSha(image),
      })
    }
    await mainBuild(first.project.id, { status: 'error' })
    await mainBuild(first.project.id, { status: 'error', branch: 'feature' })

    // snoozy: a failed build snoozed until next push, an orphan snoozed until a future time,
    // an orphan whose snooze has ended, and a failure snoozed until a push that then happened.
    const s1 = await mainBuild(snoozy.project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: s1.id, name: 'a', status: 'added' })
    await seedDiff(t.db, { buildId: s1.id, name: 'b', status: 'added' })
    await seedDiff(t.db, { buildId: s1.id, name: 'c', status: 'added' })
    const failing = await mainBuild(snoozy.project.id, { status: 'error' })
    // The failed build is newer than the orphan build, so it is not superseded.
    await t.db.insert(schema.triageItems).values([
      {
        projectId: snoozy.project.id,
        kind: 'failed',
        key: `build:${failing.number}`,
        snoozeKind: 'next_push',
        snoozedAfterBuild: failing.number,
      },
      {
        projectId: snoozy.project.id,
        kind: 'no_baseline',
        key: 'a',
        snoozeKind: 'tomorrow',
        snoozedUntil: new Date('2026-03-12T09:00:00Z'),
      },
      {
        projectId: snoozy.project.id,
        kind: 'no_baseline',
        key: 'b',
        snoozeKind: 'tomorrow',
        snoozedUntil: new Date('2026-03-10T09:00:00Z'),
      },
      {
        projectId: snoozy.project.id,
        kind: 'no_baseline',
        key: 'c',
        snoozeKind: 'next_push',
        snoozedAfterBuild: failing.number - 1,
      },
    ])

    // calm: clean. empty: no builds. outside: another workspace, must not appear.
    const ok = await mainBuild(calm.project.id, { baselineSource: 'cli' })
    await seedDiff(t.db, { buildId: ok.id, name: 'home', status: 'unchanged' })
    await mainBuild(outside.project.id, { status: 'error' })

    const counts = await countOpenTriage(t.db, { workspaceId: workspace.id, now })
    const expected = new Map<string, number>()
    for (const project of [first, calm, snoozy, empty]) {
      // oxlint-disable-next-line no-await-in-loop -- the oracle: one list per project
      const queue = await listTriage(t.db, { projectId: project.project.id, now })
      expected.set(project.project.id, queue.items.filter((i) => !i.snoozed).length)
    }
    expect(counts).toEqual(expected)
    // Not vacuous: the busy project has several, the snoozy one some, the quiet ones none.
    expect(counts.get(first.project.id)).toBeGreaterThanOrEqual(3)
    expect(counts.get(snoozy.project.id)).toBeGreaterThanOrEqual(1)
    expect(counts.get(calm.project.id)).toBe(0)
    expect(counts.get(empty.project.id)).toBe(0)
    expect(counts.has(outside.project.id)).toBe(false)
  })
})
