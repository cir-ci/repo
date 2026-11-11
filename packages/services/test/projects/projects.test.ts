import { NotFoundError, ValidationError } from '@circi/core'
import { getProjectById, listWebhooks } from '@circi/db/queries'
import { createTestDb, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addWebhook,
  changeProjectSettings,
  removeWebhook,
  sendTestWebhook,
  updateProjectAppearance,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('updateProjectAppearance', () => {
  it('saves colour and icon, and a bad value changes neither', async () => {
    const { project } = await seedProject(t.db)
    expect(await updateProjectAppearance(t.db, project.id, { color: 'plum', icon: 'zap' })).toEqual(
      {
        color: 'plum',
        icon: 'zap',
      },
    )
    await expect(
      updateProjectAppearance(t.db, project.id, { color: 'olive', icon: 'bogus' }),
    ).rejects.toThrow(/icon/)
    expect(await updateProjectAppearance(t.db, project.id, {})).toEqual({
      color: 'plum',
      icon: 'zap',
    })
  })
})

describe('changeProjectSettings', () => {
  it('saves the given parts and returns all of them; a bad value changes nothing', async () => {
    const { project } = await seedProject(t.db)
    const saved = await changeProjectSettings(t.db, project.id, {
      name: '  Web  ',
      diffThreshold: 0.5,
    })
    expect(saved.name).toBe('Web')
    expect(saved.diffThreshold).toBe(0.5)
    await expect(
      changeProjectSettings(t.db, project.id, { name: 'Other', defaultBranch: '  ' }),
    ).rejects.toThrow(/branch name is required/)
    expect((await getProjectById(t.db, project.id))?.name).toBe('Web')
  })
})

describe('webhooks', () => {
  it('adds one with a secret, tests it, and removes it', async () => {
    const { project } = await seedProject(t.db)
    const hook = await addWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.example.com/a',
      events: ['build.completed'],
    })
    expect(hook.secret).toMatch(/^whsec_/)
    expect(await listWebhooks(t.db, project.id)).toHaveLength(1)
    expect(await sendTestWebhook(t.db, project.id, hook.id)).toMatch(/^[0-9a-f-]{36}$/)
    await removeWebhook(t.db, project.id, hook.id)
    expect(await listWebhooks(t.db, project.id)).toHaveLength(0)
    await expect(removeWebhook(t.db, project.id, hook.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses a test for another project, or for a webhook with no events', async () => {
    const { project } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const hook = await addWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.example.com/b',
      events: ['build.reviewed'],
    })
    await expect(sendTestWebhook(t.db, other.project.id, hook.id)).rejects.toThrow(NotFoundError)
    await expect(
      addWebhook(t.db, { projectId: project.id, url: 'https://hooks.example.com/c', events: [] }),
    ).rejects.toThrow(ValidationError)
  })
})
