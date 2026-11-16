import {
  createTestDb,
  seedBuild,
  seedNotification,
  seedProject,
  seedWorkspace,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { jobIsForDeletedWorkspace, markWorkspaceDeleted } from '#src/repositories/index.ts'
import type { Job } from '#src/types.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const jobFor = (notificationId: string): Job => ({
  id: 1,
  queue: 'notify',
  payload: { notificationId },
  dedupeKey: null,
  status: 'pending',
  runAt: new Date(),
  attempts: 0,
  maxAttempts: 5,
  lockedUntil: null,
  lastError: null,
  createdAt: new Date(),
  finishedAt: null,
})

describe('jobIsForDeletedWorkspace for a notification', () => {
  it('finds the workspace through the build, the project or the workspace the notice names', async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const build = await seedBuild(t.db, project.id, { branch: 'main' })
    const byBuild = await seedNotification(t.db, { userId: owner.id, buildId: build.id })
    const byProject = await seedNotification(t.db, {
      userId: owner.id,
      kind: 'flaky_detected',
      projectId: project.id,
    })
    const byWorkspace = await seedNotification(t.db, {
      userId: owner.id,
      kind: 'connection_needs_attention',
      workspaceId: workspace.id,
    })
    const other = await seedWorkspace(t.db)
    const elsewhere = await seedNotification(t.db, {
      userId: owner.id,
      kind: 'connection_needs_attention',
      workspaceId: other.workspace.id,
    })
    const notices = [byBuild, byProject, byWorkspace, elsewhere]

    for (const n of notices) {
      // oxlint-disable-next-line no-await-in-loop -- a few reads
      expect(await jobIsForDeletedWorkspace(t.db, jobFor(n.id))).toBe(false)
    }
    await markWorkspaceDeleted(t.db, {
      workspaceId: workspace.id,
      deletedBy: null,
      now: new Date(),
    })
    const answers = await Promise.all(
      notices.map((n) => jobIsForDeletedWorkspace(t.db, jobFor(n.id))),
    )
    expect(answers).toEqual([true, true, true, false])
  })
})
