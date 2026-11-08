import { createHmac } from 'node:crypto'

import {
  createBuild,
  getBuild,
  linkProjectToGithub,
  listBuildReviews,
  schema,
  setCheckRunId,
} from '@circi/db'
import { completeBuild } from '@circi/services'
import { createTestDb, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../../src/http/app.ts'
import { createTestAuth, seedTenant, type Tenant } from '../../support/helpers.ts'

const SECRET = 'whsec-test'
const GITHUB_ID = '1234'

let t: TestDb
let app: FastifyInstance
let acme: Tenant
const sent: string[] = []
let n = 0

beforeAll(async () => {
  t = await createTestDb()
  const auth = createTestAuth(t.db)
  acme = await seedTenant(auth, t.db)
  await linkProjectToGithub(t.db, acme.project.id, { installationId: '99', repoRef: 'Acme/Web' })
  // The owner linked their GitHub login.
  await t.db.insert(schema.account).values({
    id: 'acc-1',
    accountId: GITHUB_ID,
    providerId: 'github',
    userId: acme.owner.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    githubWebhook: {
      db: t.db,
      secret: SECRET,
      publicOrigin: 'https://ci.acme.io',
      logger: pino({ level: 'silent' }),
      github: {
        react: async (_i, _r, commentId, content) => {
          sent.push(`react ${commentId} ${content}`)
        },
        reply: async (_i, _r, pr, body) => {
          sent.push(`reply ${pr}: ${body}`)
        },
      },
    },
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await t.close()
})

/** A finished build with changes on PR `pr`, with a check run id. */
async function changedBuild(pr: number) {
  n += 1
  const build = await createBuild(t.db, {
    projectId: acme.project.id,
    commitSha: `abc${1000 + n}`,
    branch: 'feature',
    prNumber: pr,
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  await completeBuild(
    t.db,
    { ...build, status: 'processing' },
    { conclusion: 'changes_detected', approval: 'none' },
  )
  await setCheckRunId(t.db, build.id, `check-${build.id}`)
  return build
}

function deliver(
  event: string,
  payload: unknown,
  options: { delivery?: string; secret?: string } = {},
) {
  const body = JSON.stringify(payload)
  n += 1
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': options.delivery ?? `d-${n}`,
      'x-hub-signature-256': `sha256=${createHmac('sha256', options.secret ?? SECRET)
        .update(body)
        .digest('hex')}`,
    },
    payload: body,
  })
}

const buttonPress = (build: { id: string }, identifier: string, senderId = GITHUB_ID) => ({
  action: 'requested_action',
  requested_action: { identifier },
  check_run: { id: `check-${build.id}` },
  sender: { id: Number(senderId), login: 'ann' },
  installation: { id: 99 },
  repository: { full_name: 'Acme/Web' },
})

const comment = (pr: number, body: string, senderId = GITHUB_ID, type = 'User') => ({
  action: 'created',
  issue: { number: pr, pull_request: {} },
  comment: { id: 555, body, user: { id: Number(senderId), login: 'ann', type } },
  installation: { id: 99 },
  repository: { full_name: 'acme/web' },
})

const reviewState = async (id: string) => (await getBuild(t.db, id))?.reviewStatus

describe('GitHub webhook', () => {
  it('refuses a bad signature', async () => {
    const res = await deliver('ping', { zen: 'x' }, { secret: 'wrong' })
    expect(res.statusCode).toBe(401)
  })

  it('acknowledges events it does not use', async () => {
    expect((await deliver('ping', { zen: 'x' })).statusCode).toBe(200)
  })

  it('approves from the Approve button, and records where it came from', async () => {
    const build = await changedBuild(10)
    expect((await deliver('check_run', buttonPress(build, 'approve'))).statusCode).toBe(200)
    expect(await reviewState(build.id)).toBe('approved')
    const [latest] = await listBuildReviews(t.db, build.id)
    expect(latest).toMatchObject({ state: 'approved', source: 'github-check' })
  })

  it('handles each delivery once', async () => {
    const build = await changedBuild(11)
    const press = buttonPress(build, 'reject')
    await deliver('check_run', press, { delivery: 'same-1' })
    expect(await reviewState(build.id)).toBe('rejected')
    // GitHub redelivers; a changed mind in between must not be undone by the replay.
    await deliver('check_run', buttonPress(build, 'approve'), { delivery: 'other-1' })
    expect(await reviewState(build.id)).toBe('approved')
    const replay = await deliver('check_run', press, { delivery: 'same-1' })
    expect(replay.json()).toMatchObject({ duplicate: true })
    expect(await reviewState(build.id)).toBe('approved')
  })

  it('does nothing for a GitHub user who is not linked, and tells them how to link', async () => {
    const build = await changedBuild(12)
    sent.length = 0
    await deliver('check_run', buttonPress(build, 'approve', '777'))
    expect(await reviewState(build.id)).toBe('pending')
    expect(sent.some((m) => m.startsWith('reply 12:') && m.includes('GitHub'))).toBe(true)
  })

  it('approves and rejects from /circi comments, reacting with a thumb', async () => {
    const build = await changedBuild(20)
    sent.length = 0
    await deliver('issue_comment', comment(20, 'Looks good\n/circi approve'))
    expect(await reviewState(build.id)).toBe('approved')
    expect(sent).toContain('react 555 +1')
    await deliver('issue_comment', comment(20, '/circi reject'))
    expect(await reviewState(build.id)).toBe('rejected')
  })

  it('acts on the newest commit of the pull request only', async () => {
    const older = await changedBuild(21)
    const newer = await changedBuild(21)
    await deliver('issue_comment', comment(21, '/circi approve'))
    expect(await reviewState(newer.id)).toBe('approved')
    expect(await reviewState(older.id)).toBe('pending')
  })

  it('re-processes a build on /circi rerun', async () => {
    const build = await changedBuild(22)
    await deliver('issue_comment', comment(22, '/circi rerun'))
    const after = await getBuild(t.db, build.id)
    expect(after).toMatchObject({ status: 'processing', conclusion: null, reviewStatus: 'pending' })
    const queued = await t.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.queue, 'process-build'))
    expect(queued.some((j) => j.payload.buildId === build.id)).toBe(true)
  })

  it('ignores other people’s comments, bots, plain text and unlinked users', async () => {
    const build = await changedBuild(23)
    sent.length = 0
    await deliver('issue_comment', comment(23, '/circi approve', '777'))
    expect(sent.some((m) => m.startsWith('reply 23:'))).toBe(true)
    await deliver('issue_comment', comment(23, '/circi approve', GITHUB_ID, 'Bot'))
    await deliver('issue_comment', comment(23, 'I would /circi approve this'))
    expect(await reviewState(build.id)).toBe('pending')
  })

  it('thumbs-down a command that did nothing', async () => {
    sent.length = 0
    await deliver('issue_comment', comment(999, '/circi approve'))
    expect(sent).toContain('react 555 -1')
  })
})
