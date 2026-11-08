import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedDiff,
  seedProject,
  seedUser,
  type TestDb,
} from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dismissTriageItem, listTriage, schema, setTriageRotation } from '../../src/index.ts'

let t: TestDb
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
    // Orphan: the first build had nothing to compare with.
    const first = await mainBuild(project.id, { baselineSource: 'none' })
    await seedDiff(t.db, { buildId: first.id, name: 'pricing', status: 'added' })
    await seedDiff(t.db, { buildId: first.id, name: 'home', status: 'added' })
    // Flaky: `home` changes in three of the next builds.
    const history = []
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const b = await mainBuild(project.id, { baselineSource: 'cli' })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: b.id, name: 'home', status: 'changed' })
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
    const { project, org, owner } = await seedProject(t.db)
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: mate.id })
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
    expect(queue.items[0]?.assignee).toEqual({ id: mate.id, name: mate.name })
    // Weeks from 2026-03-02: 03-09 is the second, so `mate` has this one.
    expect(queue.rotation.onTriage).toEqual({ id: mate.id, name: mate.name })
    expect(queue.rotation.until?.toISOString()).toBe('2026-03-16T00:00:00.000Z')
    expect(queue.rotation.members.map((m) => m.id)).toEqual([owner.id, mate.id])
  })
})
