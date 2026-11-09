import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sealSecret } from '@circi/core/node'
import { getIntegration } from '@circi/db/queries'
import { QUEUES } from '@circi/db/queue'
import { createBuild, createIntegration, setIntegrationTeam } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedTeam,
  seedReviewRequest,
  seedUser,
  seedChangedSnapshots,
} from '@circi/db/testing'
import type { IntegrationDefinition } from '@circi/integrations'
import { notifyOverdueReviews, requestReview, reviewBuild } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { fakeSlackHost } from '@circi/testing/hosts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { integrationEvent } from '#jobs/integration-event.ts'
import { startWorker } from '#src/index.ts'

const SECRET = 'a-long-instance-secret-for-tests-0123456789'
const ORIGIN = 'https://ci.acme.io'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup(options: { events?: string[]; mapped?: boolean } = {}) {
  await t.db.delete(schema.jobs)
  const { team, workspace, owner } = await seedTeam(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: reviewer.id })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  await seedChangedSnapshots(t.db, build.id)
  const integration = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'slack',
    displayName: 'Acme',
    externalId: `T${Math.random().toString(36).slice(2, 8)}`,
    encryptedCredentials: sealSecret(SECRET, 'xoxb-good'),
  })
  if (options.mapped !== false) {
    await setIntegrationTeam(t.db, {
      integrationId: integration.id,
      teamId: team.id,
      externalRef: 'C123',
      extra: { name: 'reviews', ...(options.events ? { events: options.events } : {}) },
    })
  }
  return { team, workspace, owner, reviewer, build, integration }
}

const jobs = () =>
  t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.integrationEvent))

type Edge = Pick<IntegrationDefinition.Context, 'config' | 'fetch'>

/** Runs every queued integration job the way the worker would. */
async function drain(edge: Edge) {
  const results = []
  for (const job of await jobs()) {
    const deps = { db: t.db, context: { ...edge, authSecret: SECRET, publicOrigin: ORIGIN } }
    // oxlint-disable-next-line no-await-in-loop -- in order
    results.push(await integrationEvent(deps, job))
  }
  return results
}

describe('integrationEvent (Slack)', () => {
  it('posts a review request once, to the team channel, with a link to the build', async () => {
    const { owner, reviewer, build, team, workspace } = await setup()
    const host = fakeSlackHost(['xoxb-good'])
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    expect(await drain(host.integrations)).toEqual([{ status: 'sent', kind: 'slack' }])
    expect(host.posted).toHaveLength(1)
    expect(host.posted[0]).toMatchObject({ channel: 'C123', token: 'xoxb-good' })
    expect(host.posted[0]?.text).toContain('Review requested')
    expect(JSON.stringify(host.posted[0]?.blocks)).toContain(
      `${ORIGIN}/${workspace.slug}/${team.slug}/builds/${build.number}`,
    )
    expect(JSON.stringify(host.posted[0]?.blocks)).toContain(reviewer.name)
  })

  it('posts a rejection with its reason, once', async () => {
    const { owner, build } = await setup()
    const host = fakeSlackHost(['xoxb-good'])
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'Logo <overlaps>',
    })
    // Deciding twice changes nothing and queues nothing more.
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'again',
    })
    await drain(host.integrations)
    expect(host.posted).toHaveLength(1)
    expect(host.posted[0]?.text).toContain('Changes rejected')
    expect(JSON.stringify(host.posted[0]?.blocks)).toContain('Logo &lt;overlaps&gt;')
  })

  it('posts an overdue notice once even if the sweep runs again', async () => {
    const { reviewer, build } = await setup()
    const host = fakeSlackHost(['xoxb-good'])
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      dueAt: new Date('2026-03-10T12:00:00Z'),
    })
    const now = new Date('2026-03-10T15:00:00Z')
    await notifyOverdueReviews(t.db, { now })
    await notifyOverdueReviews(t.db, { now })
    await drain(host.integrations)
    expect(host.posted.map((m) => m.text)).toEqual([expect.stringContaining('Review overdue')])
  })

  it('sends nothing when the team has no channel', async () => {
    const { owner, reviewer, build } = await setup({ mapped: false })
    const host = fakeSlackHost(['xoxb-good'])
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect(await jobs()).toHaveLength(0)
    expect(host.posted).toHaveLength(0)
  })

  it('sends only the events the mapping lists, and re-checks the mapping when the job runs', async () => {
    const { owner, reviewer, build, integration, team } = await setup({
      events: ['build.rejected'],
    })
    const host = fakeSlackHost(['xoxb-good'])
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    expect(await jobs()).toHaveLength(0)
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect(await jobs()).toHaveLength(1)
    // The channel is cleared before the worker gets to it.
    await t.db.delete(schema.integrationTeams).where(eq(schema.integrationTeams.teamId, team.id))
    expect(await drain(host.integrations)).toEqual([
      { status: 'skipped', reason: 'team is not mapped' },
    ])
    expect(host.posted).toHaveLength(0)
    expect(integration.id).toBeTruthy()
  })

  it('does not tell the channel about someone asking themselves', async () => {
    const { owner, build } = await setup()
    await requestReview(t.db, { buildId: build.id, reviewerId: owner.id, requestedById: owner.id })
    expect(await jobs()).toHaveLength(0)
  })

  it('flags the integration as needing attention when Slack revokes the token, and then stops', async () => {
    const { owner, build, integration } = await setup()
    const host = fakeSlackHost(['xoxb-good'])
    host.revoke('xoxb-good')
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    const [result] = await drain(host.integrations)
    expect(result).toMatchObject({ status: 'needs-attention' })
    const after = await getIntegration(t.db, integration.workspaceId, integration.id)
    expect(after).toMatchObject({ needsAttention: true })
    expect(after?.needsAttentionReason).toContain('token_revoked')
    // Further events create no jobs for it until it is reinstalled.
    await t.db.delete(schema.jobs)
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await jobs()).toHaveLength(0)
  })

  it('throws for other Slack failures so the queue retries', async () => {
    const { owner, build } = await setup()
    const broken: Edge = {
      config: {
        slack: { clientId: 'cid', clientSecret: 'csecret', apiUrl: 'https://slack.test/api' },
      },
      fetch: async () => Response.json({ ok: false, error: 'ratelimited' }),
    }
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    await expect(drain(broken)).rejects.toThrow('ratelimited')
  })
})

describe('the worker', () => {
  it('claims a queued Slack job and posts it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'circi-slack-worker-'))
    const { owner, build } = await setup()
    const host = fakeSlackHost(['xoxb-good'])
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    const worker = await startWorker({
      db: t.db,
      storage: new FsStorage({ path: dir }),
      logger: { info() {}, warn() {}, error() {} },
      integrations: host.integrations,
      authSecret: SECRET,
      publicOrigin: ORIGIN,
      pollIntervalMs: 20,
      retentionIntervalMs: 0,
      reviewSweepIntervalMs: 0,
      uploadTimeoutMinutes: 0,
    })
    try {
      await expect.poll(() => host.posted.length, { timeout: 3_000 }).toBe(1)
    } finally {
      await worker.stop()
      await rm(dir, { recursive: true, force: true })
    }
    expect(host.posted).toHaveLength(1)
    const [row] = await jobs()
    expect(row?.status).toBe('done')
  })
})
