import { createHmac } from 'node:crypto'

import { getBuild, listBuildReviews } from '@circi/db/queries'
import { setCheckRunId } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import {
  createTestDb,
  seedAccount,
  seedBuild,
  seedGitLink,
  seedChangedSnapshots,
} from '@circi/db/testing'
import { providerRegistry } from '@circi/integrations/git'
import { githubWebhookVerifier } from '@circi/integrations/github'
import { completeBuild } from '@circi/services'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, seedTenant, type Tenant } from '#test/support/helpers.ts'

const SECRET = 'whsec-test'
const GITHUB_ID = '1234'

let t: createTestDb.Result
let app: FastifyInstance
let acme: Tenant
const sent: string[] = []
let n = 0

beforeAll(async () => {
  t = await createTestDb()
  const auth = createTestAuth(t.db)
  acme = await seedTenant(auth, t.db)
  await seedGitLink(t.db, acme.project.id, { externalId: '99', repoRef: 'Acme/Web' })
  // The owner linked their GitHub login.
  await seedAccount(t.db, { userId: acme.owner.id, accountId: GITHUB_ID })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    gitWebhook: {
      db: t.db,
      authSecret: 'instance-secret',
      publicOrigin: 'https://ci.acme.io',
      logger: pino({ level: 'silent' }),
      // The fake GitHub edge: verifies like the App does, and records what is said on GitHub.
      providers: providerRegistry({
        github: {
          ...githubWebhookVerifier(SECRET),
          react: async (_i: string, _r: string, commentId: string, content: string) => {
            sent.push(`react ${commentId} ${content}`)
          },
          reply: async (_i: string, _r: string, pr: number, body: string) => {
            sent.push(`reply ${pr}: ${body}`)
          },
          noteOnCheckRun: async (
            _i: string,
            _r: string,
            checkRunId: string,
            note: { title: string; summary: string },
          ) => {
            sent.push(`note ${checkRunId}: ${note.title}: ${note.summary}`)
          },
        },
      }),
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
  const build = await seedBuild(t.db, acme.project.id, {
    commitSha: `abc${1000 + n}`,
    branch: 'feature',
    prNumber: pr,
    status: 'processing',
  })
  await seedChangedSnapshots(t.db, build.id)
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

/** The review states the comment refresh was queued for (`git-notify` dedupe keys end with it). */
const noticeStates = async (id: string) =>
  (await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'git-notify')))
    .filter((j) => j.payload.buildId === id)
    .map((j) => j.dedupeKey?.split(':').at(-1))

describe('GitHub webhook', () => {
  it('the pull request author replaces the login CI sent', async () => {
    n += 1
    const build = await seedBuild(t.db, acme.project.id, {
      commitSha: `def${2000 + n}`,
      branch: 'feature',
      prNumber: 31,
      author: { login: 'ci-pusher' },
    })
    const res = await deliver('pull_request', {
      action: 'opened',
      pull_request: { number: 31, user: { id: Number(GITHUB_ID), login: 'ann' } },
      installation: { id: 99 },
      repository: { full_name: 'acme/web' },
    })
    expect(res.statusCode).toBe(200)
    expect(await getBuild(t.db, build.id)).toMatchObject({
      authorLogin: 'ann',
      authorUserId: acme.owner.id,
    })
  })

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
    // The comment and check follow: a notice for the approved state is queued.
    expect(await noticeStates(build.id)).toContain('approved')
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
    expect(await noticeStates(build.id)).toContain('approved')
    await deliver('issue_comment', comment(20, '/circi reject'))
    expect(await reviewState(build.id)).toBe('rejected')
    expect(await noticeStates(build.id)).toContain('rejected')
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

  it("ignores other people's comments, bots, plain text and unlinked users", async () => {
    const build = await changedBuild(23)
    sent.length = 0
    await deliver('issue_comment', comment(23, '/circi approve', '777'))
    expect(sent.some((m) => m.startsWith('reply 23:'))).toBe(true)
    await deliver('issue_comment', comment(23, '/circi approve', GITHUB_ID, 'Bot'))
    await deliver('issue_comment', comment(23, 'I would /circi approve this'))
    expect(await reviewState(build.id)).toBe('pending')
  })

  it('thumbs-down a command that did nothing, and says why in one reply', async () => {
    sent.length = 0
    await deliver('issue_comment', comment(999, '/circi approve'))
    expect(sent).toEqual([
      'react 555 -1',
      "reply 999: There's no CirCI build for this pull request yet. Reply again once your tests have uploaded screenshots.",
    ])
  })
})

/** A build in the given state on `pr` (none for a branch build), with a check run id. */
async function seeded(
  pr: number | undefined,
  state: { status: 'complete' | 'processing' | 'error'; conclusion?: 'no_changes' },
) {
  n += 1
  const build = await seedBuild(t.db, acme.project.id, {
    commitSha: `fed${3000 + n}`,
    branch: 'feature',
    ...(pr === undefined ? {} : { prNumber: pr }),
    ...state,
  })
  await setCheckRunId(t.db, build.id, `check-${build.id}`)
  return build
}

const requireApproval = (value: boolean) =>
  t.db
    .update(schema.projects)
    .set({ autoApproveNoChanges: !value })
    .where(eq(schema.projects.id, acme.project.id))

describe('GitHub webhook: pull requests closing and the installation', () => {
  async function openRequest(buildId: string) {
    const [row] = await t.db
      .insert(schema.reviewRequests)
      .values({ buildId, reviewerId: acme.owner.id, reviewerName: 'Owner' })
      .returning()
    return row?.id ?? ''
  }
  const requestState = async (id: string) =>
    (await t.db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.id, id)))[0]
      ?.state

  const closed = (pr: number, merged: boolean) => ({
    action: 'closed',
    pull_request: { number: pr, merged, user: { id: Number(GITHUB_ID), login: 'ann' } },
    installation: { id: 99 },
    repository: { full_name: 'acme/web' },
  })

  it('closing a pull request closes the open review requests on its builds, merged or not', async () => {
    const build = await changedBuild(60)
    const other = await changedBuild(61)
    const request = await openRequest(build.id)
    const unrelated = await openRequest(other.id)
    expect((await deliver('pull_request', closed(60, false))).statusCode).toBe(200)
    expect(await requestState(request)).toBe('dismissed')
    expect(await requestState(unrelated)).toBe('open')
    // The build's own review state is untouched.
    expect(await reviewState(build.id)).toBe('pending')
    await deliver('pull_request', closed(61, true))
    expect(await requestState(unrelated)).toBe('dismissed')
  })

  const attention = async () =>
    (await t.db.select().from(schema.integrations).where(eq(schema.integrations.externalId, '99')))[0]

  it('removing or suspending the installation flags the connection, restoring it clears the flag', async () => {
    const hook = (action: string) => ({ action, installation: { id: 99 } })
    await deliver('installation', hook('deleted'))
    expect(await attention()).toMatchObject({ needsAttention: true })
    expect((await attention())?.needsAttentionReason).toMatch(/GitHub App was removed/)
    await deliver('installation', hook('unsuspend'))
    expect(await attention()).toMatchObject({ needsAttention: false, needsAttentionReason: null })
    await deliver('installation', hook('suspend'))
    expect(await attention()).toMatchObject({ needsAttention: true })
    await deliver('installation', hook('created'))
    expect(await attention()).toMatchObject({ needsAttention: false })
  })

  it('ignores an installation the instance does not know', async () => {
    const res = await deliver('installation', { action: 'deleted', installation: { id: 5 } })
    expect(res.statusCode).toBe(200)
    expect(await attention()).toMatchObject({ needsAttention: false })
  })
})

describe('GitHub webhook: which builds can be approved', () => {
  it('approves a no-change build that awaits approval from a comment and from the button alike', async () => {
    await requireApproval(true)
    try {
      const byComment = await seeded(30, { status: 'complete', conclusion: 'no_changes' })
      sent.length = 0
      await deliver('issue_comment', comment(30, '/circi approve'))
      expect(await reviewState(byComment.id)).toBe('approved')
      expect(sent).toEqual(['react 555 +1'])
      const [latest] = await listBuildReviews(t.db, byComment.id)
      expect(latest).toMatchObject({ state: 'approved', source: 'github-comment' })

      const byButton = await seeded(undefined, { status: 'complete', conclusion: 'no_changes' })
      await deliver('check_run', buttonPress(byButton, 'approve'))
      expect(await reviewState(byButton.id)).toBe('approved')
    } finally {
      await requireApproval(false)
    }
  })

  it('says a no-change build needs no approval when the project passes it on its own', async () => {
    const build = await seeded(31, { status: 'complete', conclusion: 'no_changes' })
    sent.length = 0
    await deliver('issue_comment', comment(31, '/circi approve'))
    expect(await reviewState(build.id)).toBe('pending')
    expect(sent).toEqual([
      'react 555 -1',
      "reply 31: Nothing to approve: the latest build has no visual changes, and this project doesn't require approval.",
    ])
  })

  it('says a build that is still processing, or failed, is not ready', async () => {
    const busy = await seeded(32, { status: 'processing' })
    sent.length = 0
    await deliver('issue_comment', comment(32, '/circi reject'))
    expect(sent).toEqual([
      'react 555 -1',
      'reply 32: The latest build is still processing. Reply `/circi reject` again when its check finishes.',
    ])
    expect(await reviewState(busy.id)).toBe('pending')

    await seeded(33, { status: 'error' })
    sent.length = 0
    await deliver('issue_comment', comment(33, '/circi approve'))
    expect(sent).toEqual([
      'react 555 -1',
      "reply 33: The latest build failed, so there's nothing to approve. `/circi rerun` processes it again.",
    ])
  })

  it('a button pressed on a build that cannot be approved says why on the check itself', async () => {
    const busy = await seeded(undefined, { status: 'processing' })
    sent.length = 0
    await deliver('check_run', buttonPress(busy, 'approve'))
    expect(sent).toEqual([
      `note check-${busy.id}: Nothing to decide: The latest build is still processing. Reply \`/circi approve\` again when its check finishes.`,
    ])
  })

  it('a non-member pressing a button on a build with no pull request is told on the check', async () => {
    const build = await seeded(undefined, { status: 'complete', conclusion: 'no_changes' })
    sent.length = 0
    await deliver('check_run', buttonPress(build, 'approve', '777'))
    expect(await reviewState(build.id)).toBe('pending')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(new RegExp(`^note check-${build.id}: Not allowed: .*with GitHub`))
  })

  it('a non-member on a pull request build gets the help on the check and in the one help comment', async () => {
    const build = await changedBuild(34)
    sent.length = 0
    await deliver('check_run', buttonPress(build, 'approve', '777'))
    expect(sent.map((m) => m.split(':')[0])).toEqual([`note check-${build.id}`, 'reply 34'])
  })
})
