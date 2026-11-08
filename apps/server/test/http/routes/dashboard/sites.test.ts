import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { type Auth } from '@circi/auth'
import { packSite as packWithCli, uploadSite } from '@circi/cli'
import { schema } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { addTestMember, createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import * as tar from 'tar'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

/**
 * Hosted sites end to end: upload, the sign-in handoff, serving, and the rules that keep an
 * uploaded site away from the dashboard and from other sites.
 */

const DASH = 'https://ci.acme.io'
const SITES = 'example-sites.com'
const originFor = (label: string) => `https://${label}.${SITES}`
const COMMIT = 'a'.repeat(40)
const COMMIT2 = 'b'.repeat(40)

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: Auth
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let apiUrl = ''
let rivalCookie: string

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-sites-'))
  auth = createTestAuth(t.db)
  const storage = new FsStorage({ path: join(dir, 'files') })
  const sites = { host: SITES, maxBytes: 5 * 1024 * 1024, originFor }
  app = buildServer({
    logger: pino({ level: process.env.TEST_LOG ?? 'silent' }),
    checks: [],
    siteServing: {
      db: t.db,
      storage,
      publicOrigin: DASH,
      sites,
      secret: 'test-secret-that-is-long-enough-1234',
      revalidateMs: 0,
    },
    api: { db: t.db, auth, storage, publicOrigin: DASH, sites },
    dashboard: { db: t.db, auth, storage, publicOrigin: DASH, sites },
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  apiUrl = `http://127.0.0.1:${address.port}`
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  await t.db
    .update(schema.projects)
    .set({ staticHostingEnabled: true })
    .where(eq(schema.projects.id, acme.project.id))
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

/** A `.tar.gz` of the given files, made by the real `tar`. */
async function packSite(files: Record<string, string>, extra?: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(dir, 'site-'))
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), content)
    }),
  )
  await extra?.(root)
  const chunks: Buffer[] = []
  for await (const chunk of tar.create({ gzip: true, cwd: root }, ['.']))
    chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const STORYBOOK = {
  'index.html': '<h1>Storybook</h1>',
  'iframe.html': '<iframe-page>',
  'index.json': '{"entries":{}}',
  'assets/app.js': 'console.log("story")',
}

async function upload(
  files: Record<string, string>,
  query: Record<string, string>,
  token = acme.token,
  extra?: (root: string) => Promise<void>,
) {
  const qs = new URLSearchParams({ commit: COMMIT, ...query }).toString()
  return app.inject({
    method: 'POST',
    url: `/v1/sites?${qs}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
    payload: await packSite(files, extra),
  })
}

const labelOf = (address: string) => new URL(address).hostname.replace(`.${SITES}`, '')
const siteGet = (
  label: string,
  path = '/',
  headers: Record<string, string> = {},
  method: 'GET' | 'HEAD' | 'POST' = 'GET',
) => app.inject({ method, url: path, headers: { host: `${label}.${SITES}`, ...headers } })

/** Signs in to a site as `cookie`'s dashboard user: the dashboard hands over a token, the site swaps it. */
async function openSite(label: string, cookie = ownerCookie, path = '/') {
  const hand = await app.inject({
    method: 'POST',
    url: '/api/site-handoff',
    headers: { cookie, origin: DASH, 'content-type': 'application/json' },
    payload: JSON.stringify({ label, returnPath: path }),
  })
  if (hand.statusCode !== 200) return { hand, siteCookie: '', url: '' }
  const url = new URL(hand.json().url)
  const done = await siteGet(label, url.pathname + url.search)
  const raw =
    [done.headers['set-cookie']]
      .flat()
      .map(String)
      .find((c) => c.startsWith('__Host-circi_site=')) ?? ''
  return { hand, done, siteCookie: raw.split(';')[0] ?? '', url: url.toString() }
}

describe('uploading a site', () => {
  it('needs hosting switched on for the project, and refuses non-archives', async () => {
    const off = await upload(STORYBOOK, { name: 'storybook' }, rival.token)
    expect(off.statusCode).toBe(403)
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sites?commit=${COMMIT}`,
      headers: { authorization: `Bearer ${acme.token}`, 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(415)
  })

  it('stores the site, detects its kind, and returns commit and branch addresses', async () => {
    const res = await upload(STORYBOOK, {
      name: 'storybook',
      branch: 'feature/x',
      branch_tip: COMMIT,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.site).toMatchObject({ name: 'storybook', kind: 'storybook' })
    expect(body.site.slug).toMatch(/^web-storybook/)
    expect(body.addresses.commit).toMatch(
      /^https:\/\/aaaaaaaaaaaa-web-storybook[a-z0-9-]*\.example-sites\.com$/,
    )
    expect(body.addresses.branch).toMatch(
      /^https:\/\/[0-9a-f]{12}-web-storybook[a-z0-9-]*\.example-sites\.com$/,
    )
    expect(body.branchMoved).toBe(true)
  })

  it('does not move the branch address for a commit that is not the tip, or from a fork', async () => {
    const notTip = await upload(STORYBOOK, {
      name: 'storybook',
      commit: COMMIT2,
      branch: 'feature/x',
      branch_tip: COMMIT,
    })
    expect(notTip.json().branchMoved).toBe(false)
    const fork = await upload(STORYBOOK, {
      name: 'storybook',
      commit: COMMIT2,
      branch: 'main',
      branch_tip: COMMIT2,
      fork: 'true',
    })
    expect(fork.json().branchMoved).toBe(false)
    expect(fork.json().addresses.branch).toBeUndefined()
  })

  it('replaces the files of the same commit on a re-run, keeping its address', async () => {
    const first = await upload(
      { ...STORYBOOK, 'index.html': 'v1' },
      { name: 'rerun', commit: 'c'.repeat(40) },
    )
    const second = await upload(
      { ...STORYBOOK, 'index.html': 'v2' },
      { name: 'rerun', commit: 'c'.repeat(40) },
    )
    expect(second.json().replaced).toBe(true)
    expect(second.json().addresses.commit).toBe(first.json().addresses.commit)
    const { siteCookie } = await openSite(labelOf(first.json().addresses.commit))
    const page = await siteGet(labelOf(first.json().addresses.commit), '/', { cookie: siteCookie })
    expect(page.body).toBe('v2')
  })

  it('rejects hostile archives: symlinks, and bad kinds of entry', async () => {
    const res = await upload({ 'index.html': 'x' }, { name: 'bad' }, acme.token, async (root) => {
      await symlink('/etc/passwd', join(root, 'passwd-link'))
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/SymbolicLink|regular files/)
  })

  it('rejects a site that is too big', async () => {
    const res = await upload(
      { 'index.html': 'x', 'big.bin': 'z'.repeat(6 * 1024 * 1024) },
      { name: 'big' },
    )
    expect([400, 413]).toContain(res.statusCode)
  })
})

describe('opening a site', () => {
  let label = ''
  beforeAll(async () => {
    const res = await upload(STORYBOOK, { name: 'open', commit: 'd'.repeat(40) })
    label = labelOf(res.json().addresses.commit)
  })

  it('sends a visitor with no cookie to sign in on the dashboard, remembering where they were going', async () => {
    const res = await siteGet(label, '/assets/app.js?x=1')
    expect(res.statusCode).toBe(302)
    const to = new URL(String(res.headers.location))
    expect(to.origin).toBe(DASH)
    expect(to.pathname).toBe('/_sso/site')
    expect(to.searchParams.get('host')).toBe(label)
    expect(to.searchParams.get('return')).toBe('/assets/app.js?x=1')
  })

  it('answers a missing site exactly like a real one, so addresses can’t be probed', async () => {
    const real = await siteGet(label)
    const ghost = await siteGet(`${'0'.repeat(12)}-nothing-here`)
    const junk = await siteGet('not-an-address')
    expect([ghost.statusCode, junk.statusCode]).toEqual([302, 302])
    const shape = (r: typeof real) =>
      `${r.statusCode} ${new URL(String(r.headers.location)).pathname}`
    expect(shape(ghost)).toBe(shape(real))
    expect(shape(junk)).toBe(shape(real))
  })

  it('serves the site after the handoff, with caching and isolation headers', async () => {
    const { siteCookie, done } = await openSite(label)
    expect(done?.statusCode).toBe(302)
    expect(done?.headers.location).toBe('/')
    const setCookie = String(
      [done?.headers['set-cookie']].flat().find((c) => String(c).startsWith('__Host-')),
    )
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    expect(setCookie).toMatch(/Path=\//)
    expect(setCookie).not.toMatch(/Domain=/)

    const page = await siteGet(label, '/', { cookie: siteCookie })
    expect(page.statusCode).toBe(200)
    expect(page.body).toBe('<h1>Storybook</h1>')
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(page.headers['cache-control']).toBe('private, no-cache')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['content-security-policy']).toBe(`frame-ancestors 'self' ${DASH}`)
    expect(page.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(page.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(page.headers['set-cookie']).toBeUndefined()

    const etag = String(page.headers.etag)
    expect(
      (await siteGet(label, '/', { cookie: siteCookie, 'if-none-match': etag })).statusCode,
    ).toBe(304)
    expect(
      (await siteGet(label, '/assets/app.js', { cookie: siteCookie })).headers['content-type'],
    ).toContain('javascript')
    const head = await siteGet(label, '/', { cookie: siteCookie }, 'HEAD')
    expect(head.statusCode).toBe(200)
    // HEAD reports the size GET would send, with no body.
    expect(head.headers['content-length']).toBe(String(page.rawPayload.length))
    expect(head.rawPayload.length).toBe(0)
    expect((await siteGet(label, '/missing.html', { cookie: siteCookie })).statusCode).toBe(404)
    expect((await siteGet(label, '/', { cookie: siteCookie }, 'POST')).statusCode).toBe(405)
  })

  it('never serves paths outside the site, or CirCI’s reserved prefix', async () => {
    const { siteCookie } = await openSite(label)
    const paths = [
      '/../etc/passwd',
      '/%2e%2e/secret',
      '/assets/%2e%2e/%2e%2e/x',
      '/_circi/nav.js',
      '/_circi/sites.json',
    ]
    const codes = await Promise.all(
      paths.map(async (path) => (await siteGet(label, path, { cookie: siteCookie })).statusCode),
    )
    expect(codes).toEqual([404, 404, 404, 404, 404])
  })

  it('spends a token once, and only for the address it was made for', async () => {
    const other = await upload(STORYBOOK, { name: 'other', commit: 'e'.repeat(40) })
    const otherLabel = labelOf(other.json().addresses.commit)
    const { url } = await openSite(label)
    const replay = new URL(url)
    const again = await siteGet(label, replay.pathname + replay.search)
    expect(String(again.headers.location)).toContain('/_sso/site')
    // A token for one address means nothing on another.
    const mine = await app.inject({
      method: 'POST',
      url: '/api/site-handoff',
      headers: { cookie: ownerCookie, origin: DASH, 'content-type': 'application/json' },
      payload: JSON.stringify({ label }),
    })
    const token = new URL(mine.json().url).searchParams.get('t')
    const wrong = await siteGet(otherLabel, `/_circi/auth?t=${token}`)
    expect(String(wrong.headers.location)).toContain('/_sso/site')
    expect(wrong.headers['set-cookie']).toBeUndefined()
  })

  it('does not accept one site’s cookie on another site', async () => {
    const other = await upload(STORYBOOK, { name: 'cross', commit: 'f'.repeat(40) })
    const otherLabel = labelOf(other.json().addresses.commit)
    const { siteCookie } = await openSite(label)
    const res = await siteGet(otherLabel, '/', { cookie: siteCookie })
    expect(res.statusCode).toBe(302)
  })

  it('gives the same "not found" to outsiders and to unknown addresses at the handoff', async () => {
    const outsider = await openSite(label, rivalCookie)
    const unknown = await openSite('000000000000-ghost', ownerCookie)
    expect(outsider.hand.statusCode).toBe(404)
    expect(unknown.hand.statusCode).toBe(404)
    expect(outsider.hand.body).toBe(unknown.hand.body)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/site-handoff',
          headers: { origin: DASH, 'content-type': 'application/json' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(401)
  })

  it('ends access when the dashboard session ends', async () => {
    const { siteCookie } = await openSite(label)
    expect((await siteGet(label, '/', { cookie: siteCookie })).statusCode).toBe(200)
    const [row] = await t.db.select().from(schema.siteSessions)
    await t.db.delete(schema.session).where(eq(schema.session.id, row?.authSessionId ?? ''))
    expect((await siteGet(label, '/', { cookie: siteCookie })).statusCode).toBe(302)
    ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  })

  it('ends access when the person leaves the organization', async () => {
    const { siteCookie } = await openSite(label)
    expect((await siteGet(label, '/', { cookie: siteCookie })).statusCode).toBe(200)
    const [seat] = await t.db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, acme.owner.id))
    await t.db.delete(schema.member).where(eq(schema.member.userId, acme.owner.id))
    expect((await siteGet(label, '/', { cookie: siteCookie })).statusCode).toBe(302)
    if (seat)
      await addTestMember(t.db, { orgId: seat.organizationId, userId: seat.userId, role: 'owner' }) // the later tests need the seat back
  })
})

const healthAt = (host: string) => app.inject({ url: '/healthz', headers: { host } })

describe('the sites domain', () => {
  it('serves nothing at its apex or on look-alike or deeper names, and leaves other hosts alone', async () => {
    expect((await healthAt(SITES)).statusCode).toBe(404)
    expect((await healthAt(`a.b.${SITES}`)).statusCode).toBe(404)
    // Not under the sites domain: the normal app answers.
    expect((await healthAt(`x.evil-${SITES}`)).statusCode).toBe(200)
    expect((await healthAt('ci.acme.io')).statusCode).toBe(200)
  })

  it('clears cookies a site stuffed into the jar, keeping its own', async () => {
    const res = await siteGet('0'.repeat(12) + '-x', '/', {
      cookie: 'junk1=aaaa; junk2=bbbb; __Host-circi_site=keepme',
    })
    const cookies = [res.headers['set-cookie']].flat().map(String)
    expect(cookies.some((c) => c.startsWith('junk1=;') && c.includes('Max-Age=0'))).toBe(true)
    expect(cookies.some((c) => c.startsWith('junk2=;') && c.includes(`Domain=${SITES}`))).toBe(true)
    expect(cookies.some((c) => c.startsWith('__Host-circi_site='))).toBe(false)
  })

  it('accepts very large cookie headers instead of refusing the request', async () => {
    const res = await siteGet('0'.repeat(12) + '-x', '/', { cookie: `bomb=${'x'.repeat(30_000)}` })
    expect(res.statusCode).toBe(302)
  })
})

describe('service workers', () => {
  it('are refused except on a commit address of a kind that needs one', async () => {
    const playwright = {
      'index.html': 'r',
      'data/a.png': 'p',
      'trace/index.html': 't',
      'trace/sw.js': 'self',
    }
    const pw = await upload(playwright, {
      name: 'pw',
      commit: '1'.repeat(40),
      branch: 'main',
      branch_tip: '1'.repeat(40),
    })
    expect(pw.json().site.kind).toBe('playwright-report')
    const commitLabel = labelOf(pw.json().addresses.commit)
    const branchLabel = labelOf(pw.json().addresses.branch)
    const { siteCookie } = await openSite(commitLabel)
    const worker = { cookie: siteCookie, 'service-worker': 'script' }
    expect((await siteGet(commitLabel, '/trace/sw.js', worker)).statusCode).toBe(200)

    // A Storybook may not register one at all.
    const sb = await upload(STORYBOOK, { name: 'nosw', commit: '2'.repeat(40) })
    const sbLabel = labelOf(sb.json().addresses.commit)
    const sbCookie = (await openSite(sbLabel)).siteCookie
    expect(
      (await siteGet(sbLabel, '/assets/app.js', { cookie: sbCookie, 'service-worker': 'script' }))
        .statusCode,
    ).toBe(404)
    expect((await siteGet(sbLabel, '/assets/app.js', { cookie: sbCookie })).statusCode).toBe(200)

    // A branch address of a worker kind hands over to the commit address.
    const branchCookie = (await openSite(branchLabel)).siteCookie
    const moved = await siteGet(branchLabel, '/trace/sw.js', { cookie: branchCookie })
    expect(moved.statusCode).toBe(302)
    expect(moved.headers.location).toBe(`${originFor(commitLabel)}/trace/sw.js`)
  })
})

describe('circi site upload', () => {
  const exec = promisify(execFile)
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
  const git = async (cwd: string, ...args: string[]) =>
    (await exec('git', args, { cwd, env: gitEnv })).stdout.trim()

  it('uploads a built site from a checkout, and its branch address follows the tip', async () => {
    const repo = await mkdtemp(join(dir, 'repo-'))
    const built = join(repo, 'storybook-static')
    await mkdir(join(built, 'assets'), { recursive: true })
    await Promise.all(
      Object.entries(STORYBOOK).map(([path, content]) => writeFile(join(built, path), content)),
    )
    await git(repo, 'init', '-q', '-b', 'main')
    await git(repo, 'remote', 'add', 'origin', repo)
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'one')
    await git(repo, 'fetch', '-q', 'origin')
    const lines: string[] = []
    const first = await uploadSite({
      dir: built,
      apiUrl,
      token: acme.token,
      name: 'cli-storybook',
      cwd: repo,
      env: {},
      log: (l) => void lines.push(l),
    })
    expect(first.site.kind).toBe('storybook')
    expect(first.branchMoved).toBe(true)
    expect(first.addresses.branch).toBeDefined()
    expect(lines.join('\n')).toContain('commit:')

    // A new commit not pushed anywhere: the remote tip is unknown, so it must descend from what
    // the branch address serves now (it does), and the address moves.
    await writeFile(join(built, 'index.html'), 'second')
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-q', '-m', 'two')
    const second = await uploadSite({
      dir: built,
      apiUrl,
      token: acme.token,
      name: 'cli-storybook',
      cwd: repo,
      env: {},
      log: () => {},
    })
    expect(second.branchMoved).toBe(true)
    expect(second.addresses.branch).toBe(first.addresses.branch)
    expect(second.addresses.commit).not.toBe(first.addresses.commit)
  })

  it('refuses a site containing symbolic links, naming them', async () => {
    const built = await mkdtemp(join(dir, 'links-'))
    await writeFile(join(built, 'index.html'), 'x')
    await symlink('/etc/passwd', join(built, 'secrets'))
    await expect(packWithCli(built)).rejects.toThrow(/symbolic links.*secrets/)
  })

  it('refuses something that is not a directory', async () => {
    await expect(packWithCli(join(dir, 'nope'))).rejects.toThrow(/not a directory/)
  })
})

describe('the project’s Sites page API', () => {
  it('lists sites with their branch and commit addresses, only for members', async () => {
    await upload(STORYBOOK, {
      name: 'listed',
      commit: '7'.repeat(40),
      branch: 'main',
      branch_tip: '7'.repeat(40),
    })
    const res = await app.inject({
      url: `/api/projects/${acme.orgSlug}/web/sites`,
      headers: { cookie: ownerCookie },
    })
    expect(res.statusCode).toBe(200)
    const listing = res.json()
    expect(listing.configured).toBe(true)
    const site = listing.sites.find((x: { name: string }) => x.name === 'listed')
    expect(site).toMatchObject({ kind: 'storybook', kindLabel: 'Storybook' })
    expect(site.branches[0]).toMatchObject({ branch: 'main', commitSha: '7'.repeat(40) })
    expect(site.branches[0].address).toMatch(
      /^https:\/\/[0-9a-f]{12}-web-listed.*\.example-sites\.com$/,
    )
    expect(site.versions[0]).toMatchObject({ commitSha: '7'.repeat(40), branch: 'main' })
    expect(site.versions[0].address).toMatch(/^https:\/\/777777777777-/)

    const outsider = await app.inject({
      url: `/api/projects/${acme.orgSlug}/web/sites`,
      headers: { cookie: rivalCookie },
    })
    expect(outsider.statusCode).toBe(404)
  })
})

describe('the flaky screenshots API', () => {
  it('answers for members with a report, and with "not found" for outsiders', async () => {
    const own = await app.inject({
      url: `/api/projects/${acme.orgSlug}/web/flaky`,
      headers: { cookie: ownerCookie },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json()).toMatchObject({ flaky: expect.any(Array), builds: expect.any(Number) })
    const outsider = await app.inject({
      url: `/api/projects/${acme.orgSlug}/web/flaky`,
      headers: { cookie: rivalCookie },
    })
    expect(outsider.statusCode).toBe(404)
  })
})
