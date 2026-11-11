// oxlint-disable vitest/valid-expect -- expect(value, message) names the failing path in loops
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '#clients/admin.ts'
import {
  makeSiteDir,
  postSiteArchive,
  siteCookieFor,
  siteRequest,
  tgzOf,
  uploadSiteCli,
  type tarOf,
} from '#clients/sites.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * Hostile and oversized site archives through the real `POST /v1/sites`, and the CLI's own limit
 * message. The server runs with a 1 MB site limit. Whatever is refused or neutralised, nothing may
 * be written outside the storage area (checked inside the container) and the server stays healthy.
 */
describe('hostile site archives (local-disk storage, STATIC_SITES_MAX_MB=1)', () => {
  const ctx = useStack({
    dedicated: true,
    setup: true,
    sitesHost: 'sites.localhost',
    env: { STATIC_SITES_MAX_MB: '1' },
  })
  let project: CreatedProject
  let workspace: string
  let repo: Repo
  const scratch: string[] = []
  const INDEX: tarOf.Entry = { name: 'index.html', content: '<h1>ok</h1>' }

  beforeAll(async () => {
    const { setup, stack } = ctx
    workspace = setup.workspace.slug
    project = await createProject(setup.session, workspace, 'Secure')
    await setup.session.patch(`/api/projects/${workspace}/${project.slug}/settings`, {
      staticHostingEnabled: true,
    })
    repo = await Repo.create()
    await repo.commit('one')
    // A canary outside the storage area and a marker to find anything written after this point.
    await stack.exec('circi', [
      'sh',
      '-c',
      'echo canary > /tmp/e2e-canary && touch /tmp/e2e-marker && sleep 1',
    ])
  })
  afterAll(async () => {
    await repo?.destroy()
    await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })))
  })

  const post = (entries: tarOf.Entry[], query: Record<string, string> = {}) =>
    postSiteArchive(ctx.stack, project.token, tgzOf(entries), query)

  const healthy = async () => {
    const res = await fetch(`${ctx.stack.url}/readyz`)
    expect(res.status).toBe(200)
  }

  const hostile: [string, tarOf.Entry[]][] = [
    ['a path that climbs out with ../', [INDEX, { name: '../../../tmp/e2e-pwned', content: 'x' }]],
    [
      'a path that climbs out in the middle',
      [INDEX, { name: 'a/../../tmp/e2e-pwned', content: 'x' }],
    ],
    ['an absolute path', [INDEX, { name: '/tmp/e2e-pwned', content: 'x' }]],
    ['an absolute path to /etc/passwd', [INDEX, { name: '/etc/passwd', content: 'root::0:0' }]],
    ['a backslash path', [INDEX, { name: '..\\..\\tmp\\e2e-pwned', content: 'x' }]],
    ['a CirCI-reserved path', [INDEX, { name: '_circi/auth', content: 'x' }]],
    ['a directory that climbs out', [INDEX, { name: '../escape/', type: '5' }]],
    [
      'a symlink to /etc/passwd named index.html',
      [{ name: 'index.html', type: '2', linkname: '/etc/passwd' }],
    ],
    ['a symlink out of the site', [INDEX, { name: 'link', type: '2', linkname: '../../../etc' }]],
    [
      'a hard link to /etc/passwd',
      [INDEX, { name: 'hard.html', type: '1', linkname: '/etc/passwd' }],
    ],
    ['a character device', [INDEX, { name: 'dev-null', type: '3' }]],
    ['a block device', [INDEX, { name: 'dev-disk', type: '4' }]],
    ['a FIFO', [INDEX, { name: 'pipe', type: '6' }]],
    [
      'the same path twice',
      [INDEX, { name: 'a.html', content: '1' }, { name: 'a.html', content: '2' }],
    ],
    [
      'the same path twice, spelled differently',
      [INDEX, { name: 'a.html', content: '1' }, { name: './x/../a.html', content: '2' }],
    ],
  ]

  it.each(hostile)(
    'refuses %s, writes nothing outside storage, and stays healthy',
    async (_name, entries) => {
      const { stack } = ctx
      const res = await post(entries)
      expect(res.status, res.text).toBeGreaterThanOrEqual(400)
      expect(res.status, res.text).toBeLessThan(500)
      expect(typeof (res.body as { error?: string }).error).toBe('string')
      // Nothing was published: no site exists for this name.
      const listed = await ctx.setup.session.get<{ sites: unknown[] }>(
        `/api/projects/${workspace}/${project.slug}/sites`,
      )
      expect(listed.sites).toEqual([])
      await healthy()
      expect((await stack.exec('circi', ['cat', '/tmp/e2e-canary'])).stdout.trim()).toBe('canary')
      expect(
        await stack.exec('circi', ['test', '-e', '/tmp/e2e-pwned'], { allowFail: true }),
      ).toMatchObject({
        code: 1,
      })
    },
  )

  it('refuses a symlink named index.html made on disk: the CLI stops it before sending', async () => {
    // `index.html` that is a symlink to /etc/passwd, made on disk and packed by plain `tar`:
    // what an attacker with a compromised build step would produce.
    const dir = await makeSiteDir({ 'a.html': 'x' })
    scratch.push(dir)
    const { execFile } = await import('node:child_process')
    await new Promise<void>((ok, fail) =>
      execFile('ln', ['-s', '/etc/passwd', `${dir}/index.html`], (e) => (e ? fail(e) : ok())),
    )
    const out = await uploadSiteCli({
      stack: ctx.stack,
      token: project.token,
      repo,
      dir,
      name: 'link',
    })
    // The CLI refuses before sending, naming the file; the server would refuse it as well.
    expect(out.exitCode).not.toBe(0)
    expect(out.stderr).toMatch(/symbolic links or special files/)
    expect(out.stderr).toContain('index.html')
  })

  it('refuses a gzip bomb: megabytes of zeros in a few kilobytes', async () => {
    // 2 MB of zeros is about 2 KB of gzip. (The ratio guard itself is unit-tested in
    // packages/sites; with a 1 MB site limit the size limit always trips first.)
    const res = await post([INDEX, { name: 'zeros.bin', content: Buffer.alloc(2 * 1024 * 1024) }])
    expect(res.status, res.text).toBe(413)
    expect((res.body as { error: string }).error).toMatch(/expands far more|larger/)
    await healthy()
  })

  it('refuses a site over STATIC_SITES_MAX_MB with a clear CLI error', async () => {
    const { stack } = ctx
    const dir = await makeSiteDir({
      'index.html': '<h1>big</h1>',
      'blob.bin': randomBytes(1_600_000),
    })
    scratch.push(dir)
    const out = await uploadSiteCli({ stack, token: project.token, repo, dir, name: 'big' })
    expect(out.exitCode).not.toBe(0)
    expect(out.stderr).toMatch(/larger than 1048576 bytes|too large|413/i)
    await healthy()
  })

  it('refuses a huge single file without reading it all, and a declared size that lies', async () => {
    const big = await post([INDEX, { name: 'huge.bin', content: randomBytes(2_000_000) }])
    expect(big.status, big.text).toBe(413)
    // A header that claims more bytes than the archive holds: a truncated archive, not a crash.
    const lying = await post([INDEX, { name: 'liar.bin', declaredSize: 5_000_000 }])
    expect(lying.status, lying.text).toBeGreaterThanOrEqual(400)
    expect(lying.status).toBeLessThan(500)
    await healthy()
  })

  it('refuses too many files', async () => {
    const entries: tarOf.Entry[] = [INDEX]
    for (let i = 0; i < 20_100; i += 1) entries.push({ name: `f/${i}.txt`, content: '' })
    const res = await post(entries)
    expect(res.status, res.text).toBe(400)
    expect((res.body as { error: string }).error).toMatch(/More than 20000 files/)
    await healthy()
  })

  it('refuses things that are not archives, and an archive with no files', async () => {
    const garbage = await postSiteArchive(
      ctx.stack,
      project.token,
      Buffer.from('not a tarball at all'),
    )
    expect(garbage.status, garbage.text).toBeGreaterThanOrEqual(400)
    expect(garbage.status).toBeLessThan(500)
    const empty = await post([{ name: 'only-a-dir/', type: '5' }])
    expect(empty.status, empty.text).toBe(400)
    // A Storybook-looking archive without its entry page.
    const noEntry = await post([
      { name: 'iframe.html', content: 'x' },
      { name: 'index.json', content: '{}' },
    ])
    expect(noEntry.status, noEntry.text).toBe(400)
    // Names with look-alike unicode are just names: stored under their own path, nothing escapes.
    await healthy()
  })

  it('neutralises a NUL byte in a name: the tar header ends the name there, nothing escapes', async () => {
    const { stack } = ctx
    const res = await post([INDEX, { name: 'ok.html\0../../tmp/e2e-pwned', content: 'x' }], {
      name: 'nul',
      commit: 'cccccccccccccccccccccccccccccccccccccccc',
    })
    // Stored under the part before the NUL (tar names end there), never under a traversal path.
    expect(res.status, res.text).toBe(201)
    const { setup } = ctx
    const address = (res.body as { addresses: { commit: string } }).addresses.commit
    const { cookie } = await siteCookieFor(stack, setup.session, address)
    expect((await siteRequest(stack, address, '/ok.html', { cookie })).text).toBe('x')
    expect((await siteRequest(stack, address, '/tmp/e2e-pwned', { cookie })).status).toBe(404)
    expect(
      await stack.exec('circi', ['test', '-e', '/tmp/e2e-pwned'], { allowFail: true }),
    ).toMatchObject({ code: 1 })
    await healthy()
  })

  it('treats unicode and odd-but-legal names as plain names, served only by their exact path', async () => {
    const { stack, setup } = ctx
    const res = await post(
      [
        INDEX,
        { name: 'café/‮photo.html', content: '<h1>rtl</h1>' },
        { name: 'dots/..hidden', content: 'h' },
        { name: 'a b/c%2Fd.txt', content: 'spaces' },
      ],
      { name: 'odd', commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    )
    expect(res.status, res.text).toBe(201)
    const address = (res.body as { addresses: { commit: string } }).addresses.commit
    const { cookie } = await siteCookieFor(stack, setup.session, address)
    const get = (p: string) => siteRequest(stack, address, p, { cookie })
    expect((await get('/caf%C3%A9/%E2%80%AEphoto.html')).text).toContain('rtl')
    expect((await get('/a%20b/c%252Fd.txt')).text).toBe('spaces')
    // Encoded traversal and double-encoded traversal never leave the site.
    for (const p of [
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc/passwd',
      '/%252e%252e/etc/passwd',
      '/a/%00/b',
    ]) {
      const r = await get(p)
      expect(r.status, p).toBe(404)
      expect(r.text, p).not.toContain('root:')
    }
    await healthy()
  })

  it('wrote nothing outside the storage area during all of this', async () => {
    const { stack } = ctx
    const found = await stack.exec('circi', [
      'sh',
      '-c',
      // Everything created or changed since the marker, minus the storage volume, pseudo file
      // systems and temp/log noise from the running node process.
      "find / -xdev \\( -path /proc -o -path /sys -o -path /dev -o -path /var/lib/circi/files -o -path /tmp/e2e-marker \\) -prune -o -type f -newer /tmp/e2e-marker -print 2>/dev/null | grep -v -E '^(/tmp/(v8|node|\\.)|/root/\\.|/home/[^/]+/\\.)' || true",
    ])
    expect(found.stdout.trim().split('\n').filter(Boolean)).toEqual([])
    expect((await stack.exec('circi', ['cat', '/etc/passwd'])).stdout).toContain('root:')
    const sizes = await stack.exec('circi', ['sh', '-c', 'ls /var/lib/circi/files | head -5; echo'])
    expect(sizes.code).toBe(0)
  })
})
