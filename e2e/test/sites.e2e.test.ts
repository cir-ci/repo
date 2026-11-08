// oxlint-disable vitest/valid-expect -- expect(value, message) names the failing path in loops
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'

import type { Team } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addMemberViaCli,
  createWorkspace,
  createTeam,
  createUserViaCli,
  newAccount,
  signIn,
  type CreatedTeam,
  type Session,
} from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import {
  cookieFrom,
  labelOfAddress,
  makeSiteDir,
  siteCookieFor,
  siteRequest,
  uploadSiteCli,
} from '#src/sites.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * Hosted static sites on the real stack (docs/static-sites.md, PLAN §7.6): the real CLI packs and
 * uploads a built site, the dashboard lists it, and a real Chromium opens it on its own hostname
 * `<hash>-<slug>.sites.localhost:<port>` through the sign-in handoff. See e2e/README.sites.md.
 */

const STORYBOOK_V1 = {
  'index.html':
    '<!doctype html><title>Storybook</title><link rel="stylesheet" href="assets/style.css">' +
    '<h1 id="h">Storybook v1</h1><script src="assets/app.js"></script>',
  'iframe.html': '<!doctype html><title>iframe</title><p>story iframe</p>',
  'index.json': JSON.stringify({ v: 5, entries: { 'button--primary': { id: 'button--primary' } } }),
  'assets/app.js': 'document.title = "js-ran"',
  'assets/style.css': '#h { color: rgb(255, 0, 0) }',
  'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
  'assets/fonts/inter.woff2': 'not really a font',
  'docs/guide/intro.html': '<!doctype html><title>Intro</title><h1>Intro page</h1>',
  'docs/guide/index.html': '<!doctype html><title>Guide</title><h1>Guide index</h1>',
}

const ask = (s: Session, l: string) =>
  s.request('POST', '/api/site-handoff', { label: l, returnPath: '/' })

describe('static sites (local-disk storage)', () => {
  const ctx = useStack({ dedicated: true, setup: true, sitesHost: 'sites.localhost' })
  const browser = useBrowser()
  let repo: Repo
  let team: CreatedTeam
  let workspace: string
  const dirs: string[] = []
  let sha1 = ''
  let commitAddress = ''
  let branchAddress = ''

  const dir = async (files: Record<string, string | Buffer>) => {
    const d = await makeSiteDir(files)
    dirs.push(d)
    return d
  }
  const upload = async (opts: {
    files: Record<string, string | Buffer>
    name?: string
    kind?: string
    spa?: boolean
    storybook?: boolean
    env?: Record<string, string>
  }) =>
    uploadSiteCli({
      stack: ctx.stack,
      token: team.token,
      repo,
      dir: await dir(opts.files),
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.spa ? { spa: true } : {}),
      ...(opts.storybook ? { storybook: true } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    })

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  })

  const sitesList = () =>
    ctx.setup.session.get<{
      configured: boolean
      sites: {
        name: string
        kind: string
        kindLabel: string
        slug: string
        branches: { branch: string; address: string; commitSha: string }[]
        versions: { commitSha: string; branch: string | null; address: string | null }[]
      }[]
    }>(`/api/teams/${workspace}/${team.slug}/sites`)

  it('refuses an upload while hosting is off for the team, saying how to turn it on', async () => {
    const { stack, setup } = ctx
    workspace = setup.workspace.slug
    team = await createTeam(setup.session, workspace, 'Docs Hub')
    await repo.commit('one')
    sha1 = await repo.sha()
    const up = await upload({ files: STORYBOOK_V1, storybook: true })
    expect(up.exitCode).not.toBe(0)
    expect(up.stderr).toMatch(/hosting is off for this team/i)
    expect((await sitesList()).sites).toEqual([])

    await setup.session.patch<Team.Settings>(`/api/teams/${workspace}/${team.slug}/settings`, {
      staticHostingEnabled: true,
    })
    expect(stack.sitesHost).toBe('sites.localhost')
  })

  it('packs a folder with nested directories and uploads it; the CLI prints both addresses', async () => {
    const { stack } = ctx
    const up = await upload({ files: STORYBOOK_V1, storybook: true })
    expect(up.exitCode, up.stderr).toBe(0)
    expect(up.stdout).toMatch(/storybook \(storybook\): 9 files/)
    const hash = sha1.slice(0, 12)
    const origin = (label: string) => `http://${label}.sites.localhost:${stack.ports.http}`
    // `<first 12 hex of the SHA>-<slug>` on the sites domain, with the dashboard's port.
    expect(up.commitAddress).toBe(origin(`${hash}-docs-hub-storybook`))
    const branch = createHash('sha256').update('main').digest('hex').slice(0, 12)
    expect(up.branchAddress).toBe(origin(`${branch}-docs-hub-storybook`))
    commitAddress = up.commitAddress ?? ''
    branchAddress = up.branchAddress ?? ''
  })

  it('lists the site on the team’s Sites page with its kind, commit, branch and a link', async () => {
    const { stack, setup } = ctx
    const api = await sitesList()
    expect(api.configured).toBe(true)
    expect(api.sites).toHaveLength(1)
    expect(api.sites[0]).toMatchObject({
      name: 'storybook',
      kind: 'storybook',
      kindLabel: 'Storybook',
      slug: 'docs-hub-storybook',
      branches: [{ branch: 'main', address: branchAddress, commitSha: sha1 }],
      versions: [{ commitSha: sha1, branch: 'main', address: commitAddress }],
    })

    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace}/${team.slug}/sites`)
    await page.getByRole('heading', { level: 1, name: 'Sites' }).waitFor()
    await page.getByText('Storybook', { exact: true }).waitFor()
    expect(await page.getByRole('link', { name: 'main', exact: true }).getAttribute('href')).toBe(
      branchAddress,
    )
    expect(await page.getByRole('link', { name: sha1.slice(0, 7) }).getAttribute('href')).toBe(
      commitAddress,
    )
    await page.getByText(`commit ${sha1.slice(0, 7)}`).waitFor()
  })

  it('sends a signed-out visitor through the dashboard sign-in and back to the site', async () => {
    const { stack, setup } = ctx
    const { page } = browser
    await page.goto(`${commitAddress}/docs/guide/intro.html`)
    // The site asked to sign in on the dashboard, remembering the page.
    await page.waitForURL((u) => u.origin === stack.url)
    await page.getByLabel('Email').waitFor()
    await page.getByLabel('Email').fill(setup.account.email)
    await page.getByLabel('Password').fill(setup.account.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(`${commitAddress}/docs/guide/intro.html`, { timeout: 60_000 })
    await page.getByRole('heading', { name: 'Intro page' }).waitFor()
    // The site's own cookie is host-only and HttpOnly: the page cannot see it.
    const cookies = await page.context().cookies(commitAddress)
    const own = cookies.find((c) => c.name === 'circi_site')
    expect(own).toMatchObject({ httpOnly: true, path: '/', sameSite: 'Lax' })
    expect(await page.evaluate('document.cookie')).toBe('')
  })

  it('shows a signed-in member the site: CSS and JS run, nested folders and their index pages work', async () => {
    const { setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(commitAddress)
    await page.getByRole('heading', { name: 'Storybook v1' }).waitFor()
    // The script ran (right MIME type under nosniff) and the stylesheet applied.
    await expect.poll(() => page.title()).toBe('js-ran')
    expect(await page.evaluate("getComputedStyle(document.querySelector('#h')).color")).toBe(
      'rgb(255, 0, 0)',
    )
    // The signed-in dashboard session is not enough on its own: the handoff happened.
    expect(page.url()).toBe(`${commitAddress}/`)
    await page.goto(`${commitAddress}/docs/guide/`)
    await page.getByRole('heading', { name: 'Guide index' }).waitFor()
    await page.goto(`${commitAddress}/docs/guide/intro.html`)
    await page.getByRole('heading', { name: 'Intro page' }).waitFor()
    // The branch address serves the same files.
    await page.goto(branchAddress)
    await page.getByRole('heading', { name: 'Storybook v1' }).waitFor()
  })

  it('serves the right content types and caching headers, a 304 on the ETag, and a 404 page', async () => {
    const { stack, setup } = ctx
    const { cookie } = await siteCookieFor(stack, setup.session, commitAddress)
    expect(cookie).toMatch(/^circi_site=/)
    const get = (path: string, opts: Parameters<typeof siteRequest>[3] = {}) =>
      siteRequest(stack, commitAddress, path, { cookie, ...opts })

    const types: Record<string, string> = {
      '/': 'text/html; charset=utf-8',
      '/assets/app.js': 'text/javascript; charset=utf-8',
      '/assets/style.css': 'text/css; charset=utf-8',
      '/assets/logo.svg': 'image/svg+xml',
      '/assets/fonts/inter.woff2': 'font/woff2',
      '/index.json': 'application/json; charset=utf-8',
    }
    for (const [path, type] of Object.entries(types)) {
      const res = await get(path)
      expect(res.status, path).toBe(200)
      expect(res.headers['content-type'], path).toBe(type)
      expect(res.headers['x-content-type-options'], path).toBe('nosniff')
      expect(res.headers['cache-control'], path).toBe('private, no-cache')
      expect(res.headers['content-security-policy'], path).toContain(
        `frame-ancestors 'self' ${stack.url}`,
      )
    }
    const js = await get('/assets/app.js')
    const etag = `"${createHash('sha256').update(STORYBOOK_V1['assets/app.js']).digest('hex')}"`
    expect(js.headers['etag']).toBe(etag)
    expect(js.text).toBe(STORYBOOK_V1['assets/app.js'])
    const again = await get('/assets/app.js', { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
    expect(again.body.length).toBe(0)
    const head = await get('/assets/app.js', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
    expect(head.headers['content-length']).toBe(String(js.body.length))

    // Unknown paths are a 404 page (a Storybook has no SPA fallback), and it is the same
    // for traversal attempts, CirCI's reserved prefix and an unknown extension.
    for (const path of [
      '/nope',
      '/nope.js',
      '/assets/',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/_circi/x',
    ]) {
      const res = await get(path)
      expect(res.status, path).toBe(404)
      expect(res.text, path).toContain('Not found')
    }
    // Sites are read-only.
    const post = await siteRequest(stack, commitAddress, '/', { method: 'POST', cookie })
    expect(post.status).toBe(405)
  })

  it('keeps a site’s own JavaScript away from the dashboard session', async () => {
    const { stack, setup } = ctx
    const dash = stack.url
    const probe = [
      '<!doctype html><title>probe</title><pre id="out">running</pre><script>',
      '(async () => {',
      '  const out = { cookie: document.cookie }',
      `  for (const [key, path, method] of [['read', '/api/capabilities', 'GET'], ['write', '/api/site-handoff', 'POST']]) {`,
      '    try {',
      `      const r = await fetch(${JSON.stringify(dash)} + path, { method, credentials: 'include', mode: 'cors',`,
      "        headers: method === 'POST' ? { 'content-type': 'application/json' } : {},",
      "        body: method === 'POST' ? JSON.stringify({ label: 'x' }) : undefined })",
      "      out[key] = 'status ' + r.status",
      '    } catch (e) { out[key] = e.name }',
      '  }',
      '  out.sessionStorageKeys = Object.keys(sessionStorage).length',
      "  document.getElementById('out').textContent = JSON.stringify(out)",
      '})()',
      '</script>',
    ].join('\n')
    await repo.commit('probe')
    const up = await upload({
      files: { 'index.html': '<!doctype html><h1>probe site</h1>', 'probe.html': probe },
      name: 'probe',
    })
    expect(up.exitCode, up.stderr).toBe(0)
    const address = up.commitAddress ?? ''

    const page = await browser.as(setup.session)
    // The dashboard cookie is really in this browser (it is what the handoff relies on)...
    const names = (await page.context().cookies(dash)).map((c) => c.name)
    expect(names.some((n) => n.includes('session_token'))).toBe(true)
    await page.goto(`${address}/probe.html`)
    await expect.poll(() => page.locator('#out').textContent()).not.toBe('running')
    const out = JSON.parse((await page.locator('#out').textContent()) ?? '{}') as Record<
      string,
      unknown
    >
    // ...but the site sees none of it: no cookie it can read, and the cross-origin calls with
    // credentials are blocked by the browser (no CORS grant), reads and writes alike.
    expect(out['cookie']).toBe('')
    expect(out['read']).toBe('TypeError')
    expect(out['write']).toBe('TypeError')
    // Cookies are scoped: the site's lives on its own host only, the dashboard's on the dashboard's.
    const all = await page.context().cookies()
    const siteCookie = all.find((c) => c.name === 'circi_site')
    expect(siteCookie?.domain).toBe(new URL(address).hostname)
    expect(all.filter((c) => c.domain === new URL(dash).hostname).map((c) => c.name)).not.toContain(
      'circi_site',
    )

    // And the server side of it: no CORS grant for a site origin, and a mutating dashboard call
    // that carries the session cookie but a site's Origin is refused.
    const preflight = await fetch(`${dash}/api/capabilities`, {
      headers: { origin: new URL(address).origin, cookie: setup.session.cookieHeader },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    const forged = await fetch(`${dash}/api/site-handoff`, {
      method: 'POST',
      headers: {
        origin: new URL(address).origin,
        cookie: setup.session.cookieHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ label: labelOfAddress(address), returnPath: '/' }),
    })
    expect(forged.status).toBeGreaterThanOrEqual(400)
  })

  describe('who may open a site', () => {
    let outsider: Session
    let unrelated: Session

    beforeAll(async () => {
      const { stack, setup } = ctx
      // Another workspace's member, and an account that belongs to no workspace at all.
      const other = await createWorkspace(setup.session, 'Other Workspace')
      const a = await createUserViaCli(stack, { account: newAccount('outsider') })
      await addMemberViaCli(stack, other.slug, a.email)
      const b = await createUserViaCli(stack, { account: newAccount('loner') })
      outsider = await signIn(stack, a.email, a.password)
      unrelated = await signIn(stack, b.email, b.password)
    })

    it('refuses them at the handoff exactly as it refuses an address that does not exist', async () => {
      const { stack, setup } = ctx
      const label = labelOfAddress(commitAddress)
      const ghost = await ask(setup.session, 'aaaaaaaaaaaa-no-such-site')
      expect(ghost.status).toBe(404)
      for (const who of [outsider, unrelated]) {
        const res = await ask(who, label)
        expect(res.status).toBe(ghost.status)
        expect(res.body).toEqual(ghost.body)
      }
      // Without any session the handoff needs sign-in at all.
      const anonymous = await fetch(`${stack.url}/api/site-handoff`, {
        method: 'POST',
        headers: { origin: stack.url, 'content-type': 'application/json' },
        body: JSON.stringify({ label, returnPath: '/' }),
      })
      expect(anonymous.status).toBe(401)
    })

    it('shows them "Not found" in the browser and never the content', async () => {
      for (const who of [outsider, unrelated]) {
        const page = await browser.as(who)
        await page.goto(commitAddress)
        await page.getByRole('heading', { name: 'Not found' }).waitFor()
        expect(page.url().startsWith(ctx.stack.url)).toBe(true)
        expect(await page.content()).not.toContain('Storybook v1')
      }
    })

    it('does not accept a site cookie forged or taken from another address', async () => {
      const { stack, setup } = ctx
      const mine = await siteCookieFor(stack, setup.session, commitAddress)
      // The cookie works on its address...
      expect((await siteRequest(stack, commitAddress, '/', { cookie: mine.cookie })).status).toBe(
        200,
      )
      // ...not on the branch address of the same site, nor tampered with.
      for (const [address, cookie] of [
        [branchAddress, mine.cookie],
        [commitAddress, `${mine.cookie}x`],
        [commitAddress, 'circi_site=abc.def'],
      ] as const) {
        const res = await siteRequest(stack, address, '/', { cookie })
        expect(res.status).toBe(302)
        expect(res.headers['location']).toContain(`${stack.url}/_sso/site?host=`)
        expect(res.text).not.toContain('Storybook v1')
      }
    })
  })

  it('spends the sign-in token once: replaying it signs nobody in', async () => {
    const { stack, setup } = ctx
    const first = await siteCookieFor(stack, setup.session, commitAddress)
    expect(first.cookie).toMatch(/^circi_site=/)
    const u = new URL(first.tokenUrl)
    const replay = await siteRequest(stack, commitAddress, `${u.pathname}${u.search}`)
    expect(replay.status).toBe(302)
    expect(replay.headers['location']).toContain(`${stack.url}/_sso/site`)
    expect(cookieFrom(replay)).toBe('')
    // A token made for one address does nothing on another.
    const t = await setup.session.post<{ url: string }>('/api/site-handoff', {
      label: labelOfAddress(commitAddress),
      returnPath: '/',
    })
    const elsewhere = new URL(t.url)
    const wrong = await siteRequest(
      stack,
      branchAddress,
      `${elsewhere.pathname}${elsewhere.search}`,
    )
    expect(wrong.status).toBe(302)
    expect(cookieFrom(wrong)).toBe('')
    // The return path cannot be turned into an open redirect.
    const evil = await setup.session.post<{ url: string }>('/api/site-handoff', {
      label: labelOfAddress(commitAddress),
      returnPath: '//evil.example/x',
    })
    const landed = await siteRequest(
      stack,
      commitAddress,
      `${new URL(evil.url).pathname}${new URL(evil.url).search}`,
    )
    expect(landed.headers['location']).toBe('/')
  })

  it('moves the branch address to the newest upload, keeps each commit address on its own files, and re-runs replace in place', async () => {
    const { stack, setup } = ctx
    const files2 = { ...STORYBOOK_V1, 'index.html': STORYBOOK_V1['index.html'].replace('v1', 'v2') }
    await repo.commit('two')
    const sha2 = await repo.sha()
    const two = await upload({ files: files2, storybook: true })
    expect(two.exitCode, two.stderr).toBe(0)
    expect(two.branchAddress).toBe(branchAddress)
    expect(two.commitAddress).not.toBe(commitAddress)

    const read = async (address: string) => {
      const { cookie } = await siteCookieFor(stack, setup.session, address)
      return (await siteRequest(stack, address, '/', { cookie })).text
    }
    expect(await read(branchAddress)).toContain('Storybook v2')
    expect(await read(commitAddress)).toContain('Storybook v1')
    expect(await read(two.commitAddress ?? '')).toContain('Storybook v2')
    const api = await sitesList()
    expect(api.sites[0]?.branches).toMatchObject([{ branch: 'main', commitSha: sha2 }])

    // The same commit uploaded again (a CI re-run): same address, new files.
    const rerun = await upload({
      files: { ...files2, 'index.html': files2['index.html'].replace('v2', 'v2-rerun') },
      storybook: true,
    })
    expect(rerun.exitCode, rerun.stderr).toBe(0)
    expect(rerun.commitAddress).toBe(two.commitAddress)
    expect(await read(two.commitAddress ?? '')).toContain('Storybook v2-rerun')
    expect(await read(branchAddress)).toContain('Storybook v2-rerun')
    expect((await sitesList()).sites[0]?.versions).toHaveLength(2)

    // An older commit uploaded later (branch tip is sha2) does not take the branch address back.
    await repo.git('checkout', '-q', '--detach', sha1)
    const old = await upload({
      files: STORYBOOK_V1,
      storybook: true,
      env: { CIRCI_BRANCH: 'main' },
    })
    expect(old.exitCode, old.stderr).toBe(0)
    expect(old.branchAddress).toBeUndefined()
    expect(old.stdout).toMatch(/address was not moved/)
    expect(await read(branchAddress)).toContain('Storybook v2-rerun')
    await repo.git('checkout', '-q', 'main')
  })

  it('detects the kind of each site, and serves single-page apps their entry page', async () => {
    const { stack, setup } = ctx
    await repo.commit('kinds')
    const kinds: [string, Record<string, string>, string, string?][] = [
      ['plain', { 'index.html': '<h1>plain</h1>' }, 'Static site'],
      [
        'cov',
        { 'index.html': '<h1>cov</h1>', 'lcov.info': 'TN:\nend_of_record\n', 'base.css': '' },
        'Coverage report',
      ],
      ['vitest', { 'index.html': '<h1>vitest</h1>', 'html.meta.json.gz': 'x' }, 'Vitest report'],
      [
        'pw',
        { 'index.html': '<h1>pw</h1>', 'data/a.zip': 'z', 'trace/index.html': 't' },
        'Playwright report',
      ],
      ['handbook', { 'index.html': '<h1>docs</h1>' }, 'Docs', 'docs'],
      [
        'book2',
        { 'index.html': '<h1>sb</h1>', 'iframe.html': 'i', 'stories.json': '{}' },
        'Storybook',
      ],
    ]
    for (const [name, files, label, kind] of kinds) {
      const up = await upload({ files, name, ...(kind ? { kind } : {}) })
      expect(up.exitCode, `${name}: ${up.stderr}`).toBe(0)
      expect(up.stdout, name).toContain(`${name} (${kind ?? KIND_ID[label]})`)
    }
    const listed = await sitesList()
    const byName = new Map(listed.sites.map((s) => [s.name, s.kindLabel]))
    for (const [name, , label] of kinds) expect(byName.get(name), name).toBe(label)

    // An entry page is required for the kind: a Storybook has to have its index.html.
    const bad = await upload({ files: { 'iframe.html': 'x', 'index.json': '{}' }, name: 'broken' })
    expect(bad.exitCode).not.toBe(0)
    expect(bad.stderr).toMatch(/index\.html/)

    // SPA: unknown paths without an extension get the entry page, missing files still 404.
    const spa = await upload({
      files: { 'index.html': '<h1>the app</h1>', 'app.js': '1' },
      name: 'app',
      spa: true,
    })
    expect(spa.exitCode, spa.stderr).toBe(0)
    const { cookie } = await siteCookieFor(stack, setup.session, spa.commitAddress ?? '')
    const route = await siteRequest(stack, spa.commitAddress ?? '', '/settings/profile', { cookie })
    expect(route.status).toBe(200)
    expect(route.text).toContain('the app')
    expect(
      (await siteRequest(stack, spa.commitAddress ?? '', '/missing.js', { cookie })).status,
    ).toBe(404)
    // Without --spa the same unknown route is a 404 (checked on the plain site).
    const plain = (await sitesList()).sites.find((s) => s.name === 'plain')
    const plainAddress = plain?.versions[0]?.address ?? ''
    const { cookie: plainCookie } = await siteCookieFor(stack, setup.session, plainAddress)
    expect(
      (await siteRequest(stack, plainAddress, '/settings/profile', { cookie: plainCookie })).status,
    ).toBe(404)
  })

  it('never serves a site’s files from the dashboard host', async () => {
    const { stack, setup } = ctx
    const { cookie } = await siteCookieFor(stack, setup.session, commitAddress)
    expect(cookie).not.toBe('')
    for (const path of [
      '/assets/app.js',
      '/iframe.html',
      '/index.json',
      '/docs/guide/intro.html',
    ]) {
      const res = await fetch(`${stack.url}${path}`, {
        headers: { cookie: `${setup.session.cookieHeader}; ${cookie}` },
        redirect: 'manual',
      })
      const text = await res.text()
      // The dashboard's own app (or a 404), never the upload.
      expect(text, path).not.toContain('js-ran')
      expect(text, path).not.toContain('story iframe')
      expect(text, path).not.toContain('Intro page')
      expect(res.headers.get('location'), path).toBeNull()
    }
    // A site address on the dashboard host is not a thing; a dashboard address on the sites
    // domain (the apex, a deeper name) is a plain 404.
    const apex = await siteRequest(stack, `http://sites.localhost:${stack.ports.http}`, '/')
    expect(apex.status).toBe(404)
    const deeper = await siteRequest(
      stack,
      `http://x.${labelOfAddress(commitAddress)}.sites.localhost:${stack.ports.http}`,
      '/',
    )
    expect(deeper.status).toBe(404)
    const fakeLabel = await siteRequest(
      stack,
      `http://not-an-address.sites.localhost:${stack.ports.http}`,
      '/',
    )
    expect(fakeLabel.status).toBe(302)
  })

  it('stops serving an expired site, and the Sites page no longer lists it', async () => {
    const { stack, setup } = ctx
    const before = await sitesList()
    const target = before.sites.find((s) => s.name === 'plain')
    const address = target?.versions[0]?.address ?? ''
    expect(address).not.toBe('')
    // Keep the team's sites for a day, and make this one (on a branch that is not the default
    // branch's, which never expires) three days old.
    await repo.git('checkout', '-q', '-b', 'old-feature')
    await repo.commit('feature work')
    const feature = await upload({
      files: { 'index.html': '<h1>old feature</h1>' },
      name: 'oldie',
    })
    expect(feature.exitCode, feature.stderr).toBe(0)
    await setup.session.patch(`/api/teams/${workspace}/${team.slug}/settings`, {
      retentionDays: 1,
    })
    const { cookie } = await siteCookieFor(stack, setup.session, feature.commitAddress ?? '')
    expect((await siteRequest(stack, feature.commitAddress ?? '', '/', { cookie })).status).toBe(
      200,
    )
    await stack.sql(
      `update static_sites set created_at = now() - interval '3 days' where team_site_id in (select id from team_sites where name = 'oldie');` +
        ` update site_hostnames set updated_at = now() - interval '3 days' where team_site_id in (select id from team_sites where name = 'oldie')`,
    )
    await stack.exec('circi', ['circi', 'admin', 'storage', 'gc', '--grace-hours', '0'])

    const after = await sitesList()
    // The expired upload is gone from the listing; the others are untouched.
    expect(after.sites.find((s) => s.name === 'oldie')?.versions ?? []).toEqual([])
    expect(after.sites.find((s) => s.name === 'storybook')?.versions.length).toBeGreaterThan(0)
    // Its address now answers like one that never existed: sign-in, then "not found".
    const res = await siteRequest(stack, feature.commitAddress ?? '', '/', { cookie })
    expect(res.status).toBe(302)
    expect(res.text).not.toContain('old feature')
    const page = await browser.as(setup.session)
    await page.goto(feature.commitAddress ?? '')
    await page.getByRole('heading', { name: 'Not found' }).waitFor()
    await repo.git('checkout', '-q', 'main')
  })
})

const KIND_ID: Record<string, string> = {
  'Static site': 'generic',
  'Coverage report': 'coverage',
  'Vitest report': 'vitest-report',
  'Playwright report': 'playwright-report',
  Storybook: 'storybook',
}

describe('static sites (S3 storage)', () => {
  const ctx = useStack({ profile: 's3', setup: true })
  let repo: Repo
  let dirPath = ''

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
    if (dirPath) await rm(dirPath, { recursive: true, force: true })
  })

  it('stores a site’s files in the bucket and serves them back', async () => {
    const { stack, setup } = ctx
    const s3 = stack.s3
    if (!s3) throw new Error('no bucket')
    const workspace = setup.workspace.slug
    const team = await createTeam(setup.session, workspace, 'Bucket Docs')
    await setup.session.patch(`/api/teams/${workspace}/${team.slug}/settings`, {
      staticHostingEnabled: true,
    })
    const page = '<!doctype html><h1>from the bucket</h1>'
    dirPath = await makeSiteDir({ 'index.html': page, 'assets/app.js': 'console.log(1)' })
    await repo.commit('one')
    const up = await uploadSiteCli({
      stack,
      token: team.token,
      repo,
      dir: dirPath,
      name: 'docs',
    })
    expect(up.exitCode, up.stderr).toBe(0)

    const sha = createHash('sha256').update(page).digest('hex')
    const key = (await s3.list()).find((o) => o.key.includes(sha))?.key
    expect(key, 'the page is an object in the bucket').toBeDefined()
    expect((await s3.get(key ?? '')).toString()).toBe(page)

    const address = up.commitAddress ?? ''
    const { cookie } = await siteCookieFor(stack, setup.session, address)
    const res = await siteRequest(stack, address, '/', { cookie })
    expect(res.status).toBe(200)
    expect(res.text).toBe(page)
    const js = await siteRequest(stack, address, '/assets/app.js', { cookie })
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(js.text).toBe('console.log(1)')
  })
})
