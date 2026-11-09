import { ValidationError } from '@circi/core'
import { createTestDb, seedTeam } from '@circi/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, pgErrorCode } from '#src/index.ts'
import { listWebhookDeliveries, listWebhooks } from '#src/queries/index.ts'
import {
  createWebhook,
  deleteWebhook,
  pruneWebhookDeliveries,
  recordWebhookDelivery,
} from '#src/queue/index.ts'
import * as schema from '#src/schema/index.ts'

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

describe('webhook deliveries', () => {
  it('keeps the newest attempts per webhook and lists at most the limit', async () => {
    const { team } = await seedTeam(t.db)
    const make = () =>
      createWebhook(t.db, {
        teamId: team.id,
        url: 'https://hooks.acme.io/x',
        events: ['build.completed'],
      })
    const [a, b] = [await make(), await make()]
    for (let i = 1; i <= 55; i++) {
      // oxlint-disable-next-line no-await-in-loop -- ordered inserts
      await recordWebhookDelivery(t.db, {
        webhookId: a.id,
        deliveryId: `d-${i}`,
        event: 'build.completed',
        test: false,
        attempt: i,
        statusCode: 200,
      })
    }
    await recordWebhookDelivery(t.db, {
      webhookId: b.id,
      deliveryId: 'x',
      event: 'webhook.test',
      test: true,
      attempt: 1,
      statusCode: null,
      error: 'timed out',
    })
    // Same-instant inserts have no defined order: give the attempts distinct times.
    await t.db.execute(sql`
      update webhook_deliveries
      set created_at = timestamptz '2026-01-01' + (attempt * interval '1 minute')
      where webhook_id = ${a.id}`)
    const lists = await listWebhookDeliveries(t.db, [a.id, b.id])
    expect(lists.get(a.id)).toHaveLength(20)
    expect(lists.get(a.id)?.[0]?.deliveryId).toBe('d-55')
    expect(lists.get(b.id)).toMatchObject([{ test: true, error: 'timed out', statusCode: null }])
    const count = async () =>
      (
        await t.db
          .select()
          .from(schema.webhookDeliveries)
          .where(eq(schema.webhookDeliveries.webhookId, a.id))
      ).length
    expect(await count()).toBeGreaterThanOrEqual(50)
    await pruneWebhookDeliveries(t.db, a.id)
    expect(await count()).toBe(50)
    expect((await listWebhookDeliveries(t.db, [a.id], 3)).get(a.id)).toHaveLength(3)
    expect((await listWebhookDeliveries(t.db, [])).size).toBe(0)
  })
})
