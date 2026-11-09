import { sealSecret } from '@circi/core/node'
import { getBuild, listBuildReviews } from '@circi/db/queries'
import {
  createTestDb,
  seedAccount,
  seedBuild,
  seedGitLink,
  seedChangedSnapshots,
} from '@circi/db/testing'
import { providerRegistry } from '@circi/integrations/git'
import { gitlabCredentials, gitlabWebhookVerifier } from '@circi/integrations/gitlab'
import { completeBuild } from '@circi/services'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, seedTenant, type Tenant } from '#test/support/helpers.ts'

const SECRET = 'gl-webhook-secret'
const AUTH_SECRET = 'instance-secret-long-enough-for-test'
const GITLAB_ID = '4321'

let t: createTestDb.Result
let app: FastifyInstance
let acme: Tenant
const sent: string[] = []
let n = 0

beforeAll(async () => {
  t = await createTestDb()
  const auth = createTestAuth(t.db)
  acme = await seedTenant(auth, t.db)
  await seedGitLink(t.db, acme.team.id, {
    kind: 'gitlab',
    externalId: 'gitlab.example.com#7',
    repoRef: 'Acme/Tools/Web',
    encryptedCredentials: sealSecret(
      AUTH_SECRET,
      gitlabCredentials('https://gitlab.example.com', 'tok'),
    ),
  })
  // The owner signed in with GitLab.
  await seedAccount(t.db, { userId: acme.owner.id, accountId: GITLAB_ID, providerId: 'gitlab' })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    gitWebhook: {
      db: t.db,
      authSecret: AUTH_SECRET,
      publicOrigin: 'https://ci.acme.io',
      logger: pino({ level: 'silent' }),
      // The fake GitLab edge: verifies the token, and records what is said on GitLab.
      providers: providerRegistry({
        gitlab: {
          ...gitlabWebhookVerifier(SECRET),
          react: async (
            repo: string,
            mr: number,
            noteId: string,
            emoji: string,
            credentials?: string,
          ) => {
            sent.push(
              `react ${repo}!${mr} ${noteId} ${emoji} ${JSON.parse(credentials ?? '{}').token}`,
            )
          },
          reply: async (_repo: string, mr: number, body: string) => {
            sent.push(`reply ${mr}: ${body}`)
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

async function changedBuild(mr: number) {
  n += 1
  const build = await seedBuild(t.db, acme.team.id, {
    commitSha: `abc${1000 + n}`,
    branch: 'feature',
    prNumber: mr,
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
  options: { uuid?: string; token?: string | null } = {},
) {
  n += 1
  return app.inject({
    method: 'POST',
    url: '/webhooks/gitlab',
    headers: {
      'content-type': 'application/json',
      'x-gitlab-event': event,
      'x-gitlab-event-uuid': options.uuid ?? `u-${n}`,
      ...(options.token === null ? {} : { 'x-gitlab-token': options.token ?? SECRET }),
    },
    payload: JSON.stringify(payload),
  })
}

const project = {
  path_with_namespace: 'acme/tools/web',
  web_url: 'https://gitlab.example.com/acme/tools/web',
}
const note = (mr: number, text: string, userId = GITLAB_ID, extra: object = {}) => ({
  object_kind: 'note',
  user: { id: Number(userId), username: 'ann' },
  project,
  object_attributes: {
    id: 555,
    note: text,
    noteable_type: 'MergeRequest',
    action: 'create',
    ...extra,
  },
  merge_request: { iid: mr },
})
const reviewState = async (id: string) => (await getBuild(t.db, id))?.reviewStatus

describe('GitLab webhook', () => {
  it('refuses a missing or wrong token, and a delivery nobody can identify is still counted once', async () => {
    expect((await deliver('Push Hook', {}, { token: 'wrong' })).statusCode).toBe(401)
    expect((await deliver('Push Hook', {}, { token: null })).statusCode).toBe(401)
    expect((await deliver('Push Hook', {})).statusCode).toBe(200)
  })

  it('the merge request author replaces the login CI sent', async () => {
    n += 1
    const build = await seedBuild(t.db, acme.team.id, {
      commitSha: `def${2000 + n}`,
      branch: 'feature',
      prNumber: 31,
      author: { login: 'ci-pusher' },
    })
    const res = await deliver('Merge Request Hook', {
      object_kind: 'merge_request',
      user: { id: Number(GITLAB_ID), username: 'ann' },
      project,
      object_attributes: { iid: 31, action: 'open', author_id: Number(GITLAB_ID) },
    })
    expect(res.statusCode).toBe(200)
    expect(await getBuild(t.db, build.id)).toMatchObject({
      authorLogin: 'ann',
      authorUserId: acme.owner.id,
    })
  })

  it('ignores merge request updates and repositories nobody linked', async () => {
    n += 1
    const build = await seedBuild(t.db, acme.team.id, {
      commitSha: `abc${3000 + n}`,
      branch: 'feature',
      prNumber: 32,
      author: { login: 'ci-pusher' },
    })
    const attrs = { iid: 32, action: 'update', author_id: 1 }
    await deliver('Merge Request Hook', {
      user: { id: 1, username: 'x' },
      project,
      object_attributes: attrs,
    })
    await deliver('Merge Request Hook', {
      user: { id: 1, username: 'x' },
      project: { ...project, path_with_namespace: 'other/repo' },
      object_attributes: { ...attrs, action: 'open' },
    })
    expect(await getBuild(t.db, build.id)).toMatchObject({ authorLogin: 'ci-pusher' })
  })

  it('approves from a note by a linked member, answers with a thumbs up, once per delivery', async () => {
    const build = await changedBuild(40)
    const first = await deliver('Note Hook', note(40, '/circi approve'), { uuid: 'same' })
    expect(first.statusCode).toBe(200)
    expect(await reviewState(build.id)).toBe('approved')
    expect(sent.at(-1)).toBe('react acme/tools/web!40 555 thumbsup tok')
    expect((await listBuildReviews(t.db, build.id))[0]).toMatchObject({ source: 'gitlab-comment' })
    expect(
      (await deliver('Note Hook', note(40, '/circi approve'), { uuid: 'same' })).json(),
    ).toMatchObject({
      duplicate: true,
    })
  })

  it('rejects, and ignores notes that are not commands, edits, and notes on other things', async () => {
    const build = await changedBuild(41)
    const before = sent.length
    await deliver('Note Hook', note(41, 'looks fine to me'))
    await deliver('Note Hook', note(41, '/circi reject', GITLAB_ID, { action: 'update' }))
    await deliver('Note Hook', note(41, '/circi reject', GITLAB_ID, { noteable_type: 'Issue' }))
    expect(await reviewState(build.id)).toBe('pending')
    expect(sent).toHaveLength(before)
    await deliver('Note Hook', note(41, '/circi reject'))
    expect(await reviewState(build.id)).toBe('rejected')
  })

  it('tells someone who is not linked how to link, and changes nothing', async () => {
    const build = await changedBuild(42)
    await deliver('Note Hook', note(42, '/circi approve', '999'))
    expect(await reviewState(build.id)).toBe('pending')
    expect(sent.at(-1)).toMatch(/^reply 42: .*Sign in at https:\/\/ci\.acme\.io with GitLab/)
  })

  it('thumbs down for a command that applies to nothing', async () => {
    await deliver('Note Hook', note(99, '/circi approve'))
    expect(sent.at(-1)).toBe('react acme/tools/web!99 555 thumbsdown tok')
  })
})
