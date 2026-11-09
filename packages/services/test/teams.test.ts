import { NotFoundError, ValidationError } from '@circi/core'
import { getTeamById, listWebhooks } from '@circi/db'
import { createTestDb, seedTeam } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addWebhook,
  changeTeamSettings,
  removeWebhook,
  sendTestWebhook,
  updateTeamAppearance,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('updateTeamAppearance', () => {
  it('saves colour and icon, and a bad value changes neither', async () => {
    const { team } = await seedTeam(t.db)
    expect(await updateTeamAppearance(t.db, team.id, { color: 'plum', icon: 'zap' })).toEqual({
      color: 'plum',
      icon: 'zap',
    })
    await expect(
      updateTeamAppearance(t.db, team.id, { color: 'olive', icon: 'bogus' }),
    ).rejects.toThrow(/icon/)
    expect(await updateTeamAppearance(t.db, team.id, {})).toEqual({ color: 'plum', icon: 'zap' })
  })
})

describe('changeTeamSettings', () => {
  it('saves the given parts and returns all of them; a bad value changes nothing', async () => {
    const { team } = await seedTeam(t.db)
    const saved = await changeTeamSettings(t.db, team.id, { name: '  Web  ', diffThreshold: 0.5 })
    expect(saved.name).toBe('Web')
    expect(saved.diffThreshold).toBe(0.5)
    await expect(
      changeTeamSettings(t.db, team.id, { name: 'Other', defaultBranch: '  ' }),
    ).rejects.toThrow(/Default branch/)
    expect((await getTeamById(t.db, team.id))?.name).toBe('Web')
  })
})

describe('webhooks', () => {
  it('adds one with a secret, tests it, and removes it', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await addWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.example.com/a',
      events: ['build.completed'],
    })
    expect(hook.secret).toMatch(/^whsec_/)
    expect(await listWebhooks(t.db, team.id)).toHaveLength(1)
    expect(await sendTestWebhook(t.db, team.id, hook.id)).toMatch(/^[0-9a-f-]{36}$/)
    await removeWebhook(t.db, team.id, hook.id)
    expect(await listWebhooks(t.db, team.id)).toHaveLength(0)
    await expect(removeWebhook(t.db, team.id, hook.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses a test for another team, or for a webhook with no events', async () => {
    const { team } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    const hook = await addWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.example.com/b',
      events: ['build.reviewed'],
    })
    await expect(sendTestWebhook(t.db, other.team.id, hook.id)).rejects.toThrow(NotFoundError)
    await expect(
      addWebhook(t.db, { teamId: team.id, url: 'https://hooks.example.com/c', events: [] }),
    ).rejects.toThrow(ValidationError)
  })
})
