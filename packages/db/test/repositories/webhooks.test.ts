import { ValidationError } from '@circi/core'
import { createTestDb, seedTeam } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  NotFoundError,
  pgErrorCode,
  schema,
} from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('webhooks', () => {
  it('creates a webhook with a secret and the events it asked for', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.reviewed'],
    })
    expect(hook.secret).toMatch(/^whsec_/)
    expect(hook.events).toEqual(['build.reviewed'])
    expect(await listWebhooks(t.db, team.id)).toHaveLength(1)
  })

  it('refuses a webhook without events: an empty list does not mean "all"', async () => {
    const { team } = await seedTeam(t.db)
    await expect(
      createWebhook(t.db, { teamId: team.id, url: 'https://hooks.acme.io/x', events: [] }),
    ).rejects.toThrow(ValidationError)
    expect(await listWebhooks(t.db, team.id)).toHaveLength(0)
  })

  it('has no way to store an empty list either (the table rejects it)', async () => {
    const { team } = await seedTeam(t.db)
    const insert = t.db.insert(schema.webhooks).values({
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      secret: 'whsec_x',
      events: [],
    })
    const err = await insert.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(pgErrorCode(err)).toBe('23514') // check_violation: webhooks_events_check
  })

  it("deletes only the team's own webhook", async () => {
    const { team } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await expect(deleteWebhook(t.db, other.team.id, hook.id)).rejects.toThrow(NotFoundError)
    await deleteWebhook(t.db, team.id, hook.id)
    expect(await listWebhooks(t.db, team.id)).toHaveLength(0)
  })
})
