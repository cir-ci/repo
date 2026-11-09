import { type Build, type Database, type ReviewRequest } from '@circi/db'
import { getBuild } from '@circi/db/queries'
import { createWebhook, linkBuildsToPullRequest, QUEUES } from '@circi/db/queue'
import {
  createBuild,
  createIntegration,
  createReviewRule,
  markFileVerified,
  planUploads,
  setIntegrationTeam,
} from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedAccount,
  seedChangedSnapshots,
  seedGitLink,
  seedReviewRequest,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import type { IntegrationDefinition } from '@circi/integrations'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  completeBuild,
  failBuild,
  finalizeBuild,
  handleGitEvents,
  notifyOverdueReviews,
  requestReview,
  requestReviews,
  requeueBuild,
  reviewBuild,
  reviewBuilds,
  reviewSnapshots,
} from '#src/index.ts'
import { notifyReviewRequested } from '#src/reviews/reviews.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function queued() {
  const rows = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.webhook))
  return rows.map((j) => j.payload)
}

async function setup() {
  await t.db.delete(schema.jobs)
  const { team, owner } = await seedTeam(t.db)
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  const processing = { ...build, status: 'processing' as const }
  return { team, owner, build: processing }
}

describe('webhook events', () => {
  it('queues build.completed with the build and team details', async () => {
    const { team, build } = await setup()
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed', 'build.reviewed'],
    })
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    const [job, ...rest] = await queued()
    expect(rest).toHaveLength(0)
    expect(job).toMatchObject({
      webhookId: hook.id,
      event: 'build.completed',
      data: {
        team: { slug: team.slug },
        build: {
          number: 1,
          status: 'complete',
          conclusion: 'changes_detected',
          reviewStatus: 'pending',
        },
      },
    })
  })

  it('queues build.reviewed with the reviewer', async () => {
    const { team, owner, build } = await setup()
    await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.reviewed'],
    })
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    expect(await queued()).toHaveLength(0) // not subscribed to build.completed
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    const [job] = await queued()
    expect(job).toMatchObject({
      event: 'build.reviewed',
      data: {
        build: { reviewStatus: 'approved' },
        review: { state: 'approved', source: 'ui', reviewer: owner.name },
      },
    })
  })

  it('skips disabled webhooks and other teams', async () => {
    const { team, build } = await setup()
    const other = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await createWebhook(t.db, {
      teamId: other.team.id,
      url: 'https://hooks.other.io/x',
      events: ['build.completed'],
    })
    await t.db
      .update(schema.webhooks)
      .set({ enabled: false })
      .where(eq(schema.webhooks.id, hook.id))
    await completeBuild(t.db, build, { conclusion: 'no_changes', approval: 'none' })
    expect(await queued()).toHaveLength(0)
  })
})

// The outbox guarantee (CLAUDE.md): a job, notice or webhook delivery exists exactly when the
// change that implies it is committed. Every service that queues something is run twice without
// committing: inside an outer transaction that throws afterwards, and through a database whose
// own `transaction` rolls back after the callback has run (so anything the service queued
// outside its transaction, straight on `db`, would survive and fail the test).

class Rollback extends Error {}

/** `db` whose transactions run their callback and then roll back. */
function rollingBack(db: Database): Database {
  const rollback = (cb: (tx: Database) => Promise<unknown>) =>
    db.transaction(async (tx) => {
      await cb(tx)
      throw new Rollback()
    })
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') return rollback
      const value: unknown = Reflect.get(target, prop, target)
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a method of the real db, bound to it
      return typeof value === 'function' ? (value.bind(target) as unknown) : value
    },
  })
}

interface World {
  teamId: string
  ownerId: string
  reviewerId: string
  /** Uploaded, with a verified file, ready to finalize. */
  uploading: { id: string }
  processing: Build
  /** Complete with changes, written by a member, on pull request 7, with an open request for bob. */
  done: { id: string }
  bobRequest: ReviewRequest
}

async function seedWorld(): Promise<World> {
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  const bob = await seedUser(t.db)
  const reviewer = await seedUser(t.db)
  await Promise.all(
    [ann, bob, reviewer].map((u) =>
      addTestMember(t.db, { workspaceId: workspace.id, userId: u.id }),
    ),
  )
  await seedAccount(t.db, { userId: reviewer.id, accountId: '99' })
  await seedGitLink(t.db, team.id, { externalId: '1', repoRef: 'acme/web' })
  await createWebhook(t.db, {
    teamId: team.id,
    url: 'https://hooks.acme.io/x',
    events: ['build.completed', 'build.reviewed'],
  })
  const slack = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'slack',
    displayName: 'Acme',
    externalId: `T${Math.random().toString(36).slice(2, 8)}`,
    encryptedCredentials: 'sealed',
  })
  await setIntegrationTeam(t.db, {
    integrationId: slack.id,
    teamId: team.id,
    externalRef: 'C1',
    extra: {
      name: 'reviews',
      events: [
        'build.completed',
        'build.approved',
        'build.rejected',
        'review.requested',
        'review.overdue',
      ],
    },
  })
  await createReviewRule(t.db, {
    teamId: team.id,
    kind: 'snapshot-name',
    pattern: 'home',
    reviewerIds: [reviewer.id],
  })

  const uploading = await createBuild(t.db, { teamId: team.id, commitSha: 'abc1001', branch: 'a' })
  const hash = fakeSha('1')
  await planUploads(t.db, {
    buildId: uploading.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(t.db, hash, { size: 10 })

  const processingRow = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1002',
    branch: 'b',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, processingRow.id))
  await seedChangedSnapshots(t.db, processingRow.id)
  const processing = await getBuild(t.db, processingRow.id)

  const done = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1003',
    branch: 'c',
    author: { login: 'ann', userId: ann.id },
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, done.id))
  await seedChangedSnapshots(t.db, done.id, ['a', 'b'])
  await linkBuildsToPullRequest(t.db, { teamId: team.id, prNumber: 7, commitSha: 'abc1003' })
  const bobRequest = await seedReviewRequest(t.db, {
    buildId: done.id,
    reviewerId: bob.id,
    requestedById: owner.id,
    dueAt: new Date('2020-01-01T00:00:00Z'),
  })
  if (!processing) throw new Error('seed lost the processing build')

  await t.db.delete(schema.jobs)
  await t.db.delete(schema.notifications)
  return {
    teamId: team.id,
    ownerId: owner.id,
    reviewerId: reviewer.id,
    uploading,
    processing,
    done,
    bobRequest,
  }
}

const noop = () => undefined
// External services are faked at their edge: the handler only reads the definition's id and
// `git.respond`, and the context's secret (unused here: the connection has no credentials).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fake of a large interface
const github = {
  id: 'github',
  name: 'GitHub',
  capabilities: { git: { respond: async () => {} } },
} as unknown as IntegrationDefinition
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fake, see above
const gitContext = {} as unknown as IntegrationDefinition.Context

interface ServiceCase {
  name: string
  /** What a commit must leave behind: jobs in these queues, and/or notifications. */
  leaves: { queues: readonly string[]; notifications?: boolean }
  /** False for a step that has no transaction of its own: it joins the caller's (not exported). */
  ownTransaction?: boolean
  run: (db: Database, w: World) => Promise<unknown>
}

const GIT_NOTIFY = 'git-notify'
const services: ServiceCase[] = [
  {
    name: 'finalizeBuild',
    leaves: { queues: [QUEUES.processBuild, GIT_NOTIFY], notifications: true },
    run: (db, w) =>
      finalizeBuild(db, {
        buildId: w.uploading.id,
        screenshots: [{ name: 'home', sha256: fakeSha('1') }],
      }),
  },
  {
    name: 'completeBuild',
    leaves: { queues: [QUEUES.webhook, GIT_NOTIFY] },
    run: (db, w) =>
      completeBuild(db, w.processing, { conclusion: 'changes_detected', approval: 'none' }),
  },
  {
    name: 'failBuild',
    leaves: { queues: [GIT_NOTIFY] },
    run: (db, w) => failBuild(db, w.processing.id, 'boom'),
  },
  {
    name: 'requeueBuild',
    leaves: { queues: [QUEUES.processBuild, GIT_NOTIFY] },
    run: (db, w) => requeueBuild(db, w.done.id),
  },
  {
    name: 'reviewBuild',
    leaves: { queues: [QUEUES.webhook, QUEUES.integrationEvent, GIT_NOTIFY], notifications: true },
    run: (db, w) => reviewBuild(db, { buildId: w.done.id, userId: w.ownerId, state: 'approved' }),
  },
  {
    name: 'reviewSnapshots',
    leaves: { queues: [QUEUES.webhook, QUEUES.integrationEvent, GIT_NOTIFY], notifications: true },
    run: (db, w) =>
      reviewSnapshots(db, {
        buildId: w.done.id,
        userId: w.ownerId,
        decision: 'approved',
        snapshotNames: 'all',
      }),
  },
  {
    name: 'reviewBuilds',
    leaves: { queues: [QUEUES.webhook, QUEUES.integrationEvent, GIT_NOTIFY], notifications: true },
    run: (db, w) =>
      reviewBuilds(db, {
        teamId: w.teamId,
        buildIds: [w.done.id],
        userId: w.ownerId,
        state: 'approved',
      }),
  },
  {
    name: 'requestReview',
    leaves: { queues: [QUEUES.integrationEvent], notifications: true },
    run: (db, w) =>
      requestReview(db, {
        buildId: w.done.id,
        reviewerId: w.reviewerId,
        requestedById: w.ownerId,
      }),
  },
  {
    name: 'requestReviews',
    leaves: { queues: [QUEUES.integrationEvent], notifications: true },
    run: (db, w) =>
      requestReviews(db, {
        teamId: w.teamId,
        buildIds: [w.done.id],
        reviewerIds: [w.reviewerId],
        requestedById: w.ownerId,
      }),
  },
  {
    name: 'notifyReviewRequested',
    ownTransaction: false,
    leaves: { queues: [QUEUES.integrationEvent], notifications: true },
    run: (db, w) => notifyReviewRequested(db, w.bobRequest, w.ownerId),
  },
  {
    name: 'notifyOverdueReviews',
    leaves: { queues: [QUEUES.integrationEvent], notifications: true },
    run: (db) => notifyOverdueReviews(db, { now: new Date('2026-01-01T00:00:00Z') }),
  },
  {
    name: 'handleGitEvents (/circi rerun)',
    leaves: { queues: [QUEUES.processBuild, GIT_NOTIFY] },
    run: (db) =>
      handleGitEvents(db, {
        definition: github,
        ctx: gitContext,
        log: { info: noop, warn: noop },
        events: [
          {
            type: 'command',
            command: 'rerun',
            number: 7,
            repo: { ref: 'acme/web', connection: { externalId: '1' } },
            actor: { accountId: '99', login: 'reviewer' },
          },
        ],
      }),
  },
  {
    name: 'handleGitEvents (/circi approve)',
    leaves: { queues: [QUEUES.webhook, QUEUES.integrationEvent, GIT_NOTIFY], notifications: true },
    run: (db) =>
      handleGitEvents(db, {
        definition: github,
        ctx: gitContext,
        log: { info: noop, warn: noop },
        events: [
          {
            type: 'command',
            command: 'approve',
            number: 7,
            repo: { ref: 'acme/web', connection: { externalId: '1' } },
            actor: { accountId: '99', login: 'reviewer' },
          },
        ],
      }),
  },
]

async function outbox() {
  const [jobs, notifications, deliveries] = await Promise.all([
    t.db.select().from(schema.jobs),
    t.db.select().from(schema.notifications),
    t.db.select().from(schema.webhookDeliveries),
  ])
  return {
    jobs,
    notifications,
    deliveries,
    events: jobs.filter((j) => j.queue === QUEUES.integrationEvent),
  }
}

describe.each(services)('outbox: $name', ({ run, leaves, ownTransaction }) => {
  it('queues nothing when the surrounding transaction rolls back', async () => {
    const w = await seedWorld()
    await expect(
      t.db.transaction(async (tx) => {
        await run(tx, w)
        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
    const out = await outbox()
    expect(out.jobs).toHaveLength(0)
    expect(out.notifications).toHaveLength(0)
    expect(out.deliveries).toHaveLength(0)
    expect(out.events).toHaveLength(0)
  })

  it.skipIf(ownTransaction === false)(
    'queues nothing outside its own transaction (rolled back after the callback)',
    async () => {
      const w = await seedWorld()
      // Some services swallow a failure (a rejected command); either way nothing may remain.
      await run(rollingBack(t.db), w).catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err
      })
      const out = await outbox()
      expect(out.jobs).toHaveLength(0)
      expect(out.notifications).toHaveLength(0)
      expect(out.deliveries).toHaveLength(0)
      expect(out.events).toHaveLength(0)
    },
  )

  it('exists exactly after commit', async () => {
    const w = await seedWorld()
    await run(t.db, w)
    const out = await outbox()
    const queues = new Set(out.jobs.map((j) => j.queue))
    for (const queue of leaves.queues) expect(queues).toContain(queue)
    expect(leaves.notifications ? out.notifications.length : 1).toBeGreaterThan(0)
  })
})
