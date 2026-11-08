import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import {
  createBuild,
  getOrganizationBySlug,
  listBuildIssueLinks,
  listIntegrations,
  schema,
} from '@circi/db'
import { type IssueTracker, ProviderApiError, type TrackerFactory } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedDiff, sha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { normalizeJiraSite } from '#http/routes/dashboard/issue-trackers.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const SECRET = 'test-secret-that-is-long-enough-1234'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-trackers-'))
const auth = createTestAuth(t.db)

/** A fake of both trackers' edges: one account each, a few targets, issues counted up. */
const fake = {
  validKeys: new Set(['lin_good', 'jira-token']),
  down: false,
  failCreate: false,
  seenCredentials: [] as string[],
  created: [] as IssueTracker.CreateInput[],
}
const factory: TrackerFactory = (kind, credentials) => {
  fake.seenCredentials.push(credentials)
  const parsed: Record<string, unknown> = JSON.parse(credentials)
  const token = [parsed.apiKey, parsed.apiToken].find((v) => typeof v === 'string') ?? ''
  const check = () => {
    if (fake.down) throw new ProviderApiError(503, 'unavailable')
    if (!fake.validKeys.has(token)) throw new ProviderApiError(401, 'bad key', { revoked: true })
  }
  return {
    kind,
    async identify() {
      check()
      return kind === 'linear'
        ? { externalId: `lin-${token}`, name: 'Acme Linear' }
        : { externalId: 'acme.atlassian.net', name: 'acme.atlassian.net' }
    },
    async listTargets() {
      check()
      return kind === 'linear'
        ? [{ ref: 'team-1', name: 'Web (WEB)' }]
        : [{ ref: 'WEB', name: 'Website (WEB)' }]
    },
    async createIssue(input) {
      check()
      if (fake.failCreate) throw new ProviderApiError(500, 'boom')
      fake.created.push(input)
      return {
        key: `${input.target.toUpperCase()}-${fake.created.length}`,
        url: `https://tracker.test/${fake.created.length}`,
        title: input.title,
      }
    },
  }
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
    trackers: factory,
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
    const res = await call('POST', `${base}/linear`, ownerCookie, { apiKey: 'lin_good' })
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
    const dup = await call('POST', `${base}/linear`, ownerCookie, { apiKey: 'lin_good' })
    expect(dup.statusCode).toBe(409)
  })

  it('stores nothing when the key is rejected (400) or the tracker is down (502)', async () => {
    const before = (await stored('linear')).length
    const bad = await call('POST', `${base}/linear`, ownerCookie, { apiKey: 'wrong' })
    expect(bad.statusCode).toBe(400)
    fake.down = true
    const down = await call('POST', `${base}/linear`, ownerCookie, { apiKey: 'lin_good' })
    fake.down = false
    expect(down.statusCode).toBe(502)
    expect((await stored('linear')).length).toBe(before)
  })

  it('connects Jira with the site, email and token', async () => {
    const res = await call('POST', `${base}/jira`, ownerCookie, {
      siteUrl: 'acme.atlassian.net/',
      email: 'ann@acme.test',
      apiToken: 'jira-token',
    })
    expect(res.statusCode).toBe(201)
    const last = JSON.parse(fake.seenCredentials.at(-1) ?? '{}')
    expect(last).toEqual({
      kind: 'jira',
      siteUrl: 'https://acme.atlassian.net',
      email: 'ann@acme.test',
      apiToken: 'jira-token',
    })
    expect((await stored('jira')).map((i) => i.displayName)).toEqual(['acme.atlassian.net'])
  })

  it('refuses a Jira address that is not an https host name', async () => {
    for (const siteUrl of ['http://127.0.0.1', 'https://localhost', 'intranet', 'ftp://x.test']) {
      // eslint-disable-next-line no-await-in-loop -- few cases
      const res = await call('POST', `${base}/jira`, ownerCookie, {
        siteUrl,
        email: 'a@b.test',
        apiToken: 'jira-token',
      })
      expect([siteUrl, res.statusCode]).toEqual([siteUrl, 400])
    }
    expect(normalizeJiraSite('https://acme.atlassian.net/jira/x')).toBe(
      'https://acme.atlassian.net',
    )
  })

  it('is for owners and admins of the organization only', async () => {
    const body = { apiKey: 'lin_good' }
    expect((await call('POST', `${base}/linear`, louCookie, body)).statusCode).toBe(403)
    expect((await call('POST', `${base}/linear`, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('POST', `${base}/linear`, '', body)).statusCode).toBe(401)
    expect((await call('POST', `${base}/linear`, ownerCookie, { nope: 1 })).statusCode).toBe(400)
  })
})

describe('mapping projects', () => {
  it('lists targets, maps a project, shows it on the page and clears it', async () => {
    const [linear] = await stored('linear')
    const id = linear?.id ?? ''
    const targets = await call('GET', `${base}/${id}/targets`, ownerCookie)
    expect(targets.json()).toEqual({ targets: [{ ref: 'team-1', name: 'Web (WEB)' }] })
    expect((await call('GET', `${base}/${id}/targets`, louCookie)).statusCode).toBe(403)
    expect((await call('GET', `${base}/${id}/targets`, rivalCookie)).statusCode).toBe(404)

    const url = `${base}/${id}/projects/web`
    expect((await call('PUT', url, ownerCookie, { target: 'nope' })).statusCode).toBe(400)
    expect((await call('PUT', url, louCookie, { target: 'team-1' })).statusCode).toBe(403)
    expect(
      (await call('PUT', `${base}/${id}/projects/ghost`, ownerCookie, { target: 'team-1' }))
        .statusCode,
    ).toBe(404)
    expect((await call('PUT', url, ownerCookie, { target: 'team-1' })).statusCode).toBe(204)

    for (const cookie of [ownerCookie, louCookie]) {
      // eslint-disable-next-line no-await-in-loop -- two viewers
      const page = await call('GET', `${base}/linear`, cookie)
      expect(page.statusCode).toBe(200)
      expect(page.json()).toMatchObject({
        canManage: cookie === ownerCookie,
        connections: [{ id, name: 'Acme Linear', needsAttention: false }],
        projects: [{ slug: 'web', integrationId: id, target: 'team-1', targetName: 'Web (WEB)' }],
      })
    }
    expect((await call('GET', `${base}/linear`, rivalCookie)).statusCode).toBe(404)

    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    const after = await call('GET', `${base}/linear`, ownerCookie)
    expect(after.json().projects[0]).toMatchObject({ integrationId: null, target: null })
  })

  it('moves a project to another connection of the same kind', async () => {
    const second = await call('POST', `${base}/linear`, ownerCookie, { apiKey: 'jira-token' })
    const [first] = await stored('linear')
    await call('PUT', `${base}/${first?.id}/projects/web`, ownerCookie, { target: 'team-1' })
    await call('PUT', `${base}/${second.json().id}/projects/web`, ownerCookie, { target: 'team-1' })
    const page = await call('GET', `${base}/linear`, ownerCookie)
    expect(page.json().projects[0].integrationId).toBe(second.json().id)
    expect(
      (await call('DELETE', `${base}/integration/${second.json().id}`, ownerCookie)).statusCode,
    ).toBe(204)
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

    await call('PUT', `${base}/${jira?.id}/projects/web`, ownerCookie, { target: 'WEB' })
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
      imageUrl: `${ORIGIN}/api/files/${sha('e')}`,
    })
    expect(sent?.description).toContain(
      `${ORIGIN}/${acme.orgSlug}/web/builds/${build.number}?shot=home`,
    )

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
    expect(await listBuildIssueLinks(t.db, build.id)).toEqual([])
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
