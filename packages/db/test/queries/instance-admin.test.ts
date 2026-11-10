import { createTestDb, seedWorkspace } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getQueueDepth, listAccounts } from '#src/queries/index.ts'
import { enqueueJob, QUEUES } from '#src/queue/index.ts'
import { workspaceDeletions } from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listAccounts', () => {
  it('counts only live workspaces', async () => {
    const live = await seedWorkspace(t.db)
    const gone = await seedWorkspace(t.db)
    await t.db.insert(workspaceDeletions).values({ workspaceId: gone.workspace.id })
    const { accounts } = await listAccounts(t.db, {
      search: live.owner.email,
      page: 1,
      pageSize: 5,
    })
    expect(accounts.find((a) => a.id === live.owner.id)?.workspaceCount).toBe(1)
    const deleted = await listAccounts(t.db, { search: gone.owner.email, page: 1, pageSize: 5 })
    expect(deleted.accounts.find((a) => a.id === gone.owner.id)?.workspaceCount).toBe(0)
  })
})

describe('getQueueDepth', () => {
  it('lists every known queue by default, even when empty', async () => {
    const depth = await getQueueDepth(t.db)
    expect(depth.map((q) => q.queue).toSorted()).toEqual(Object.values(QUEUES).toSorted())
    expect(depth.every((q) => q.pending === 0)).toBe(true)
  })

  it('counts pending jobs, and lists only the queues asked for when given', async () => {
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: { n: 1 } })
    const all = await getQueueDepth(t.db)
    expect(all.find((q) => q.queue === QUEUES.webhook)?.pending).toBe(1)
    expect(
      (await getQueueDepth(t.db, [QUEUES.processBuild])).map((q) => q.queue).toSorted(),
    ).toEqual([QUEUES.processBuild, QUEUES.webhook].toSorted())
  })
})
