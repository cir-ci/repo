import { listIgnoreRegions, listTriage } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb, seedBuild, seedTeam, seedUser } from '@circi/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assignTriage,
  createIgnoreRegion,
  deleteIgnoreRegion,
  dismissTriage,
  snoozeTriage,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-10T12:00:00Z')

/** A team whose default branch has one failed build: one triage item, `build:1`. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const failed = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
  const ref = { teamId: team.id, kind: 'failed', key: `build:${failed.number}` }
  const queue = () => listTriage(t.db, { teamId: team.id, now })
  return { team, workspace, owner, failed, ref, queue }
}

describe('assignTriage', () => {
  it('assigns an item to a member, and to nobody', async () => {
    const { workspace, ref, queue } = await setup()
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
    await assignTriage(t.db, { ...ref, assigneeId: mate.id })
    expect((await queue()).items[0]?.assignee).toEqual({
      id: mate.id,
      name: mate.name,
      image: null,
    })
    await assignTriage(t.db, { ...ref, assigneeId: null })
    expect((await queue()).items[0]?.assignee).toBeNull()
  })

  it('refuses someone outside the workspace', async () => {
    const { ref } = await setup()
    const stranger = await seedUser(t.db)
    await expect(assignTriage(t.db, { ...ref, assigneeId: stranger.id })).rejects.toThrow(/member/)
  })
})

describe('snoozeTriage', () => {
  it('hides an item until the chosen time, then it is back', async () => {
    const { ref, queue } = await setup()
    const { until } = await snoozeTriage(t.db, { ...ref, choice: 'tomorrow', now })
    expect(until?.toISOString()).toBe('2026-03-11T09:00:00.000Z')
    expect((await queue()).items[0]).toMatchObject({
      snoozed: true,
      snoozeKind: 'tomorrow',
      snoozedUntil: until,
    })
    const later = await listTriage(t.db, {
      teamId: ref.teamId,
      now: new Date('2026-03-11T09:00:00Z'),
    })
    expect(later.items[0]).toMatchObject({ snoozed: false, snoozedUntil: null, snoozeKind: null })
  })

  it('until next push lasts until a new default-branch build arrives', async () => {
    const { ref, queue } = await setup()
    await snoozeTriage(t.db, { ...ref, choice: 'next_push', now })
    expect((await queue()).items[0]).toMatchObject({ snoozed: true, snoozedUntil: null })
    await seedBuild(t.db, ref.teamId, { branch: 'feature' })
    expect((await queue()).items[0]?.snoozed).toBe(true)
    await seedBuild(t.db, ref.teamId, { branch: 'main', status: 'complete' })
    // The failure is also gone from the queue now (a later build completed); check state alone.
    const [row] = await t.db
      .select()
      .from(schema.triageItems)
      .where(and(eq(schema.triageItems.teamId, ref.teamId), eq(schema.triageItems.key, ref.key)))
    expect(row).toMatchObject({ snoozeKind: 'next_push', snoozedUntil: null })
  })

  it('needs a future date for a custom snooze', async () => {
    const { ref } = await setup()
    await expect(
      snoozeTriage(t.db, { ...ref, choice: 'date', date: new Date('2026-03-01T00:00:00Z'), now }),
    ).rejects.toThrow(/future/)
  })
})

describe('dismissTriage', () => {
  it('removes the item from the queue', async () => {
    const { ref, queue } = await setup()
    await dismissTriage(t.db, ref)
    expect((await queue()).items).toEqual([])
  })
})

describe('ignore regions', () => {
  it('creates and deletes a region, and dismisses the item it answers', async () => {
    const { team, ref, queue } = await setup()
    const region = await createIgnoreRegion(t.db, {
      teamId: team.id,
      name: 'home',
      x: 1,
      y: 2,
      width: 30,
      height: 4,
      resolves: ref,
    })
    expect(await listIgnoreRegions(t.db, team.id)).toEqual([region])
    expect((await queue()).items).toEqual([])
    await deleteIgnoreRegion(t.db, team.id, region.id)
    expect(await listIgnoreRegions(t.db, team.id)).toEqual([])
    await expect(deleteIgnoreRegion(t.db, team.id, region.id)).rejects.toThrow(/not found/)
  })

  it('stores nothing, and dismisses nothing, for an invalid region', async () => {
    const { team, ref, queue } = await setup()
    await expect(
      createIgnoreRegion(t.db, {
        teamId: team.id,
        name: 'home',
        x: 0,
        y: 0,
        width: 0,
        height: 5,
        resolves: ref,
      }),
    ).rejects.toThrow(/at least 1/)
    expect((await queue()).items).toHaveLength(1)
  })
})
