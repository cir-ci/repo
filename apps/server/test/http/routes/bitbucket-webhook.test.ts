import { createHmac } from 'node:crypto'

import { sealSecret } from '@circi/core/node'
import { getBuild, listBuildReviews } from '@circi/db/queries'
import { BitbucketCloud, providerRegistry, serializeBitbucketCredentials } from '@circi/providers'
import { completeBuild } from '@circi/services'
import {
  createTestDb,
  seedAccount,
  seedBuild,
  seedGitLink,
  seedChangedSnapshots,
} from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, seedTenant, type Tenant } from '#test/support/helpers.ts'

const SECRET = 'bb-webhook-secret'
const AUTH_SECRET = 'instance-secret-long-enough-for-test'
const ANN = '{ann-uuid}'

let t: createTestDb.Result
let app: FastifyInstance
let acme: Tenant
/** Comments the fake Bitbucket received: [path, body, authorization]. */
const posted: [string, string, string | null][] = []
let n = 0

beforeAll(async () => {
  t = await createTestDb()
  acme = await seedTenant(createTestAuth(t.db), t.db)
  await seedGitLink(t.db, acme.team.id, {
    kind: 'bitbucket',
    externalId: 'acme',
    repoRef: 'acme/Web',
    encryptedCredentials: sealSecret(AUTH_SECRET, serializeBitbucketCredentials({ token: 'tok' })),
  })
  // The owner linked their Bitbucket account.
  await seedAccount(t.db, { userId: acme.owner.id, accountId: ANN, providerId: 'bitbucket' })
  const bitbucket = new BitbucketCloud({
    webhookSecret: SECRET,
    // The edge of Bitbucket's API: only records the comments written.
    fetch: async (input, init) => {
      const req = new Request(input, init)
      posted.push([
        new URL(req.url).pathname,
        String(
          Reflect.get(Object(Reflect.get(Object(JSON.parse(await req.text())), 'content')), 'raw'),
        ),
        req.headers.get('authorization'),
      ])
      return Response.json({ id: 1 }, { status: 201 })
    },
  })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    gitWebhook: {
      db: t.db,
      providers: providerRegistry({ bitbucket }),
      authSecret: AUTH_SECRET,
      publicOrigin: 'https://ci.acme.io',
      logger: pino({ level: 'silent' }),
    },
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await t.close()
})

async function changedBuild(pr: number, extra: { branch?: string } = {}) {
  n += 1
  const build = await seedBuild(t.db, acme.team.id, {
    commitSha: `abcdef${1000 + n}`,
    branch: extra.branch ?? 'feature',
    prNumber: pr,
    status: 'processing',
  })
  await seedChangedSnapshots(t.db, build.id)
  await completeBuild(
    t.db,
    { ...build, status: 'processing' },
    { conclusion: 'changes_detected', approval: 'none' },
  )
  return build
}

function deliver(
  event: string,
  payload: unknown,
  options: { id?: string; secret?: string; header?: string } = {},
) {
  const body = JSON.stringify(payload)
  n += 1
  return app.inject({
    method: 'POST',
    url: '/webhooks/bitbucket',
    headers: {
      'content-type': 'application/json',
      'x-event-key': event,
      'x-request-uuid': options.id ?? `req-${n}`,
      [options.header ?? 'x-hub-signature']: `sha256=${createHmac(
        'sha256',
        options.secret ?? SECRET,
      )
        .update(body)
        .digest('hex')}`,
    },
    payload: body,
  })
}

const repository = { full_name: 'acme/web', workspace: { slug: 'acme' } }
const commentEvent = (pr: number, raw: string, uuid = ANN) => ({
  repository,
  pullrequest: { id: pr },
  comment: { id: 9, content: { raw }, user: { uuid, nickname: 'ann' } },
})

describe('Bitbucket webhook', () => {
  it('refuses a bad or missing signature, and a delivery without a request id', async () => {
    expect((await deliver('repo:push', {}, { secret: 'wrong' })).statusCode).toBe(401)
    expect((await deliver('repo:push', {}, { header: 'x-hub-signature-256' })).statusCode).toBe(401)
    const body = '{}'
    const noId = await app.inject({
      method: 'POST',
      url: '/webhooks/bitbucket',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
      },
      payload: body,
    })
    expect(noId.statusCode).toBe(400)
  })

  it('gives builds of the commit or branch their pull request number, and the author', async () => {
    n += 1
    const byCommit = await seedBuild(t.db, acme.team.id, {
      commitSha: `accdef${1000 + n}`,
      branch: 'other',
      author: { login: 'ci-pusher' },
    })
    const byBranch = await seedBuild(t.db, acme.team.id, {
      commitSha: `adcdef${1000 + n}`,
      branch: 'feature/x',
    })
    const unrelated = await seedBuild(t.db, acme.team.id, {
      commitSha: `aecdef${1000 + n}`,
      branch: 'main',
    })
    const res = await deliver('pullrequest:created', {
      repository,
      pullrequest: {
        id: 41,
        author: { uuid: ANN, nickname: 'ann' },
        source: { commit: { hash: byCommit.commitSha }, branch: { name: 'feature/x' } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(await getBuild(t.db, byCommit.id)).toMatchObject({
      prNumber: 41,
      authorLogin: 'ann',
      authorUserId: acme.owner.id,
    })
    expect(await getBuild(t.db, byBranch.id)).toMatchObject({ prNumber: 41, authorLogin: 'ann' })
    expect((await getBuild(t.db, unrelated.id))?.prNumber).toBeNull()
  })

  it('handles each request id once', async () => {
    const payload = commentEvent(77, 'hello')
    expect((await deliver('pullrequest:comment_created', payload, { id: 'same' })).json()).toEqual({
      ok: true,
    })
    expect((await deliver('pullrequest:comment_created', payload, { id: 'same' })).json()).toEqual({
      ok: true,
      duplicate: true,
    })
  })

  it('approves the latest builds from a comment by a linked member, and says so', async () => {
    const build = await changedBuild(51)
    posted.length = 0
    const res = await deliver('pullrequest:comment_created', commentEvent(51, '/circi approve'))
    expect(res.statusCode).toBe(200)
    expect((await getBuild(t.db, build.id))?.reviewStatus).toBe('approved')
    expect((await listBuildReviews(t.db, build.id))[0]?.source).toBe('bitbucket-comment')
    expect(posted).toHaveLength(1)
    expect(posted[0]?.[0]).toBe('/2.0/repositories/acme/web/pullrequests/51/comments')
    expect(posted[0]?.[1]).toMatch(/approved/)
    expect(posted[0]?.[2]).toBe('Bearer tok')
  })

  it('rejects, and ignores comments that are not commands', async () => {
    const build = await changedBuild(52)
    posted.length = 0
    await deliver('pullrequest:comment_created', commentEvent(52, 'looks fine to me'))
    expect((await getBuild(t.db, build.id))?.reviewStatus).toBe('pending')
    expect(posted).toHaveLength(0)
    await deliver('pullrequest:comment_created', commentEvent(52, '/circi reject'))
    expect((await getBuild(t.db, build.id))?.reviewStatus).toBe('rejected')
  })

  it('refuses someone who has not linked a Bitbucket account, and replies how', async () => {
    const build = await changedBuild(53)
    posted.length = 0
    await deliver('pullrequest:comment_created', commentEvent(53, '/circi approve', '{stranger}'))
    expect((await getBuild(t.db, build.id))?.reviewStatus).toBe('pending')
    expect(posted).toHaveLength(1)
    expect(posted[0]?.[1]).toMatch(/Link your Bitbucket account/)
  })

  it('ignores repositories no team is linked to', async () => {
    const build = await changedBuild(54)
    posted.length = 0
    await deliver('pullrequest:comment_created', {
      ...commentEvent(54, '/circi approve'),
      repository: { full_name: 'acme/other', workspace: { slug: 'acme' } },
    })
    expect((await getBuild(t.db, build.id))?.reviewStatus).toBe('pending')
    expect(posted).toHaveLength(0)
  })
})
