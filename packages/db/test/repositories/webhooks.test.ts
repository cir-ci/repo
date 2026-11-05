import { createTestDb, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createWebhook, deleteWebhook, listWebhooks, NotFoundError } from '../../src/index.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('webhooks', () => {
  it('creates a webhook with a secret and all events by default', async () => {
    const { project } = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    expect(hook.secret).toMatch(/^whsec_/)
    expect(hook.events).toEqual(['build.completed', 'build.reviewed'])
    expect(await listWebhooks(t.db, project.id)).toHaveLength(1)
  })

  it("deletes only the project's own webhook", async () => {
    const { project } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    await expect(deleteWebhook(t.db, other.project.id, hook.id)).rejects.toThrow(NotFoundError)
    await deleteWebhook(t.db, project.id, hook.id)
    expect(await listWebhooks(t.db, project.id)).toHaveLength(0)
  })
})
