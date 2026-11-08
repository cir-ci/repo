import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import {
  createBuild,
  getOrganizationBySlug,
  listBuildLinks,
  listIntegrations,
  schema,
} from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedDiff, sha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const SECRET = 'test-secret-that-is-long-enough-1234'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-trackers-'))
const auth = createTestAuth(t.db)

interface Created {
  target: string
  title: string
  /** Everything the tracker was sent, as text (the Jira description is a document). */
  text: string
}

/**
 * Linear's and Jira's HTTP edges in one `fetch`, behind the real definitions: one account each, a
 * team or project each, issues counted up, 401 for a key or token that is not in `validKeys`.
 */
const fake = {
  validKeys: new Set(['lin_good', 'jira-token']),
  down: false,
  failCreate: false,
  /** The Authorization header of every call. */
  seenAuth: [] as string[],
  created: [] as Created[],
}
const fakeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  const authorization = req.headers.get('authorization') ?? ''
  fake.seenAuth.push(authorization)
  const raw = await req.text()
  const body: Record<string, unknown> = raw ? JSON.parse(raw) : {}
  if (fake.down) return new Response('unavailable', { status: 503 })
  const key = authorization.startsWith('Basic ')
    ? Buffer.from(authorization.slice(6), 'base64').toString().split(':')[1]
    : authorization
  if (!fake.validKeys.has(key ?? ''))
    return Response.json({ errors: [{ message: 'bad' }] }, { status: 401 })
  if (url.host === 'api.linear.app') {
    const query = String(body.query)
    if (query.includes('viewer')) {
      return Response.json({
        data: { viewer: { id: 'u1', organization: { id: `lin-${key}`, name: 'Acme Linear' } } },
      })
    }
    if (query.includes('teams')) {
      return Response.json({
        data: { teams: { nodes: [{ id: 'team-1', key: 'WEB', name: 'Web' }] } },
      })
    }
    if (query.includes('issueCreate')) {
      if (fake.failCreate) return new Response('boom', { status: 500 })
      const args: Record<string, unknown> = Object(Object(body.variables).input)
      fake.created.push({
        target: String(args.teamId),
        title: String(args.title),
        text: String(args.description),
      })
      const n = fake.created.length
      return Response.json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: `i${n}`,
              identifier: `WEB-${n}`,
              url: `https://linear.test/WEB-${n}`,
              title: args.title,
            },
          },
        },
      })
    }
    return Response.json({ data: { attachmentCreate: { success: true } } })
  }
  if (url.pathname.endsWith('/myself')) return Response.json({ accountId: 'a1' })
  if (url.pathname.endsWith('/project')) return Response.json([{ key: 'WEB', name: 'Website' }])
  if (fake.failCreate) return new Response('boom', { status: 500 })
  const fields: Record<string, unknown> = Object(body.fields)
  fake.created.push({
    target: String(Object(fields.project).key),
    title: String(fields.summary),
    text: JSON.stringify(fields.description),
  })
  return Response.json({ key: `WEB-${fake.created.length}` })
}

const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: SECRET,
    integrations: { config: {}, fetch: fakeFetch },
  },
})
await app.ready()
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const acme = await seedTenant(auth, t.db)
const rival = await seedTenant(auth, t.db)
const ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      origin: ORIGIN,
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  })

const org = await getOrganizationBySlug(t.db, acme.orgSlug)
const base = `/api/orgs/${acme.orgSlug}/integrations`
const stored = async (kind: string) =>
  (await listIntegrations(t.db, org.id)).filter((i) => i.kind === kind)

describe('connecting a tracker', () => {
  it('verifies Linear with the tracker and stores the key sealed', async () => {
    const res = await call('POST', `${base}/linear/connect`, ownerCookie, { apiKey: 'lin_good' })
    expect(res.statusCode).toBe(201)
    const [row] = await t.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.id, res.json().id))
    expect(row).toMatchObject({ kind: 'linear', displayName: 'Acme Linear', orgId: org.id })
    expect(row?.encryptedCredentials).not.toContain('lin_good')
    expect(openSecret(SECRET, row?.encryptedCredentials ?? '')).toBe(
      JSON.stringify({ kind: 'linear', apiKey: 'lin_good' }),
    )
    const dup = await call('POST', `${base}/linear/connect`, ownerCookie, { apiKey: 'lin_good' })
    expect(dup.statusCode).toBe(409)
  })

  it('stores nothing when the key is rejected (400) or the tracker is down (502)', async () => {
    const before = (await stored('linear')).length
    const bad = await call('POST', `${base}/linear/connect`, ownerCookie, { apiKey: 'wrong' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('Linear did not accept those credentials')
    fake.down = true
    const down = await call('POST', `${base}/linear/connect`, ownerCookie, { apiKey: 'lin_good' })
    fake.down = false
    expect(down.statusCode).toBe(502)
    expect((await stored('linear')).length).toBe(before)
  })

  it('connects Jira with the site, email and token', async () => {
    const res = await call('POST', `${base}/jira/connect`, ownerCookie, {
      siteUrl: 'acme.atlassian.net/',
      email: 'ann@acme.test',
      apiToken: 'jira-token',
    })
    expect(res.statusCode).toBe(201)
    const [row] = await stored('jira')
    const [secret] = await t.db
      .select({ sealed: schema.integrations.encryptedCredentials })
      .from(schema.integrations)
      .where(eq(schema.integrations.id, row?.id ?? ''))
    expect(JSON.parse(openSecret(SECRET, secret?.sealed ?? '') ?? '{}')).toEqual({
      kind: 'jira',
      siteUrl: 'https://acme.atlassian.net',
      email: 'ann@acme.test',
      apiToken: 'jira-token',
    })
    expect(row?.displayName).toBe('acme.atlassian.net')
  })

  it('refuses a Jira address that is not an https host name, before calling Jira', async () => {
    const calls = fake.seenAuth.length
    for (const siteUrl of ['http://127.0.0.1', 'https://localhost', 'intranet', 'ftp://x.test']) {
      // eslint-disable-next-line no-await-in-loop -- few cases
      const res = await call('POST', `${base}/jira/connect`, ownerCookie, {
        siteUrl,
        email: 'a@b.test',
        apiToken: 'jira-token',
      })
      expect([siteUrl, res.statusCode]).toEqual([siteUrl, 400])
    }
    expect(fake.seenAuth.length).toBe(calls)
  })

  it('is for owners and admins of the organization only', async () => {
    const body = { apiKey: 'lin_good' }
    expect((await call('POST', `${base}/linear/connect`, louCookie, body)).statusCode).toBe(403)
    expect((await call('POST', `${base}/linear/connect`, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('POST', `${base}/linear/connect`, '', body)).statusCode).toBe(401)
    expect(
      (await call('POST', `${base}/linear/connect`, ownerCookie, { nope: 1 })).statusCode,
    ).toBe(400)
  })
})

describe('mapping projects', () => {
  it('lists targets, maps a project, shows it on the page and clears it', async () => {
    const [linear] = await stored('linear')
    const id = linear?.id ?? ''
    const targets = await call('GET', `${base}/${id}/targets`, ownerCookie)
    expect(targets.json()).toEqual({ targets: [{ id: 'team-1', name: 'Web (WEB)' }] })
    expect((await call('GET', `${base}/${id}/targets`, louCookie)).statusCode).toBe(403)
    expect((await call('GET', `${base}/${id}/targets`, rivalCookie)).statusCode).toBe(404)

    const url = `${base}/${id}/projects/web`
    const team = { ref: 'team-1', name: 'Web (WEB)' }
    expect((await call('PUT', url, louCookie, team)).statusCode).toBe(403)
    expect((await call('PUT', `${base}/${id}/projects/ghost`, ownerCookie, team)).statusCode).toBe(
      404,
    )
    expect((await call('PUT', url, ownerCookie, team)).statusCode).toBe(204)

    for (const cookie of [ownerCookie, louCookie]) {
      // eslint-disable-next-line no-await-in-loop -- two viewers
      const page = await call('GET', `${base}/${id}/projects`, cookie)
      expect(page.statusCode).toBe(200)
      expect(page.json()).toMatchObject({
        canManage: cookie === ownerCookie,
        integration: { id, kind: 'linear', name: 'Acme Linear', needsAttention: false },
        definition: { mapping: { targetLabel: 'Team', targetKind: 'select' } },
        projects: [
          {
            slug: 'web',
            mapping: { ref: 'team-1', name: 'Web (WEB)', extra: { name: 'Web (WEB)' } },
          },
        ],
      })
    }
    expect((await call('GET', `${base}/${id}/projects`, rivalCookie)).statusCode).toBe(404)

    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    const after = await call('GET', `${base}/${id}/projects`, ownerCookie)
    expect(after.json().projects[0]).toMatchObject({ slug: 'web', mapping: null })
  })

  it('flags the connection when the tracker rejects the saved key while listing targets', async () => {
    const res = await call('POST', `${base}/linear/connect`, ownerCookie, { apiKey: 'jira-token' })
    const id = res.json().id
    fake.validKeys.delete('jira-token')
    const list = await call('GET', `${base}/${id}/targets`, ownerCookie)
    fake.validKeys.add('jira-token')
    expect(list.statusCode).toBe(409)
    expect((await stored('linear')).find((i) => i.id === id)).toMatchObject({
      needsAttention: true,
      needsAttentionReason: 'Linear no longer accepts the saved credentials',
    })
    expect((await call('DELETE', `${base}/${id}`, ownerCookie)).statusCode).toBe(204)
  })
})

const buildUrl = (n: number) => `/api/projects/${acme.orgSlug}/web/builds/${n}`

async function setup() {
  const build = await createBuild(t.db, {
    projectId: acme.project.id,
    commitSha: `c${Math.random().toString(16).slice(2, 9)}`,
    branch: 'feat/x',
  })
  await seedDiff(t.db, {
    buildId: build.id,
    name: 'home',
    status: 'changed',
    diffFileSha256: sha('e'),
  })
  return build
}

describe('issues from a build', () => {
  it('hides the action until the project has a tracker, then creates and lists issues', async () => {
    const build = await setup()
    const [jira] = await stored('jira')
    const url = `${buildUrl(build.number)}/issues`
    expect((await call('GET', url, ownerCookie)).json()).toEqual({ issues: [], trackers: [] })
    // Not mapped yet.
    const early = await call('POST', url, ownerCookie, { integrationId: jira?.id })
    expect(early.statusCode).toBe(404)

    await call('PUT', `${base}/${jira?.id}/projects/web`, ownerCookie, {
      ref: 'WEB',
      name: 'Website (WEB)',
    })
    const trackers = (await call('GET', url, louCookie)).json().trackers
    expect(trackers).toEqual([
      { integrationId: jira?.id, kind: 'jira', name: 'acme.atlassian.net', target: 'WEB' },
    ])

    const res = await call('POST', url, louCookie, {
      integrationId: jira?.id,
      snapshotName: 'home',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ key: expect.stringMatching(/^WEB-\d+$/) })
    const sent = fake.created.at(-1)
    expect(sent).toMatchObject({
      target: 'WEB',
      title: `Visual regression: home in build #${build.number}`,
    })
    expect(sent?.text).toContain(`${ORIGIN}/api/files/${sha('e')}`)
    expect(sent?.text).toContain(`${ORIGIN}/${acme.orgSlug}/web/builds/${build.number}?shot=home`)

    const list = (await call('GET', url, ownerCookie)).json()
    expect(list.issues).toMatchObject([
      { key: res.json().key, tracker: 'jira', snapshotName: 'home', createdBy: 'Lou' },
    ])
    const detail = (await call('GET', buildUrl(build.number), ownerCookie)).json()
    expect(detail.issues).toEqual([res.json()])
    const activity = (await call('GET', `${buildUrl(build.number)}/activity`, ownerCookie)).json()
    expect(activity.events.find((e: { type: string }) => e.type === 'issue_created')).toMatchObject(
      {
        issue: { key: res.json().key, tracker: 'jira' },
        by: { name: 'Lou' },
      },
    )
  })

  it('answers 502 and stores nothing when the tracker fails', async () => {
    const build = await setup()
    const [jira] = await stored('jira')
    fake.failCreate = true
    const res = await call('POST', `${buildUrl(build.number)}/issues`, ownerCookie, {
      integrationId: jira?.id,
    })
    fake.failCreate = false
    expect(res.statusCode).toBe(502)
    expect(await listBuildLinks(t.db, build.id, 'issue')).toEqual([])
  })

  it('flags the connection when the tracker rejects the saved credentials', async () => {
    const build = await setup()
    const [jira] = await stored('jira')
    fake.validKeys.delete('jira-token')
    const res = await call('POST', `${buildUrl(build.number)}/issues`, ownerCookie, {
      integrationId: jira?.id,
    })
    fake.validKeys.add('jira-token')
    expect(res.statusCode).toBe(502)
    expect((await stored('jira'))[0]).toMatchObject({ needsAttention: true })
    // Flagged connections are not offered.
    expect(
      (await call('GET', `${buildUrl(build.number)}/issues`, ownerCookie)).json().trackers,
    ).toEqual([])
  })

  it('is for members of the organization only, and validates the body', async () => {
    const build = await setup()
    const [jira] = await stored('jira')
    const url = `${buildUrl(build.number)}/issues`
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('POST', url, rivalCookie, { integrationId: jira?.id })).statusCode).toBe(404)
    expect((await call('GET', url, '')).statusCode).toBe(401)
    expect((await call('POST', url, ownerCookie, { integrationId: 'nope' })).statusCode).toBe(400)
    expect((await call('GET', buildUrl(999) + '/issues', ownerCookie)).statusCode).toBe(404)
    const unknownShot = await call('POST', url, ownerCookie, {
      integrationId: jira?.id,
      snapshotName: 'ghost',
    })
    expect(unknownShot.statusCode).toBe(404)
  })
})
