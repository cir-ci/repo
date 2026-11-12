// oxlint-disable vitest/valid-expect -- expect(value, message) names the failing file in loops
import { createHash, randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'

import type { Build, Comment } from '@circi/api'
import { FILE_URL_WINDOW_SECONDS, signFileUrl } from '@circi/core/node'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { approveBuild, createProject, type CreatedProject } from '#clients/admin.ts'
import { makeSiteDir, uploadSiteCli } from '#clients/sites.ts'
import { fileRows } from '#clients/storage.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { screenshot } from '#stack/images.ts'
import { useStack } from '#stack/vitest.ts'

/** `BETTER_AUTH_SECRET` of the stack (e2e/compose.yml): what signed links are made with. */
const STACK_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123456789'

const path = (hash: string, query = '') => `/api/files/${hash}${query}`
const flip = (value: string) => `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

type Signed = Build.Detail & { fileSignatures?: Record<string, string> }

/**
 * Signed file links against the real server and LocalStack (apps/server/src/http/hooks/
 * file-signatures.ts, routes/dashboard/builds/files.ts): the dashboard's replies carry an
 * `exp.sig` for every file reference, `GET /api/files/:hash?exp&sig` then needs no cookie, and
 * everything that isn't a screenshot, diff or thumbnail is out of reach whatever it is signed with.
 */
describe('signed file links', () => {
  const ctx = useStack({ profile: 's3', setup: true })
  let repo: Repo
  let project: CreatedProject
  let buildNumber = 0
  let detail: Signed
  /** One screenshot, its baseline, the diff and a thumbnail of each. */
  const hashes = { head: '', base: '', diff: '', thumb: '' }
  let assetHash = ''
  let siteDir = ''
  const base = () => ctx.stack.url
  /** A request with no cookie at all: only the link decides. */
  const anonymous = (hash: string, query = '', headers: Record<string, string> = {}) =>
    fetch(`${base()}${path(hash, query)}`, { headers })
  const link = (hash: string) => {
    const [exp = '', sig = ''] = (detail.fileSignatures?.[hash] ?? '').split('.')
    return `?exp=${exp}&sig=${sig}`
  }
  const workspace = () => ctx.setup.workspace.slug

  beforeAll(async () => {
    const { stack, setup } = ctx
    repo = await Repo.create()
    project = await createProject(setup.session, workspace(), 'Signed')
    const tint = `#${randomBytes(3).toString('hex')}`
    await repo.writeShots({ home: await screenshot({ background: tint, dot: { x: 10, y: 10 } }) })
    await repo.commit('baseline')
    const first = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    await approveBuild(setup.session, workspace(), project.slug, first.build.number)
    await repo.writeShots({ home: await screenshot({ background: tint, dot: { x: 60, y: 60 } }) })
    await repo.commit('moved')
    const second = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    buildNumber = second.build.number
    // The diff image is stored by the worker: wait until the build page shows it.
    detail = await vi.waitFor(
      async () => {
        const read = await setup.session.get<Signed>(
          `/api/projects/${workspace()}/${project.slug}/builds/${buildNumber}`,
        )
        if (!read.diffs[0]?.diff || !read.diffs[0].base)
          throw new Error(
            `no diff image yet: ${JSON.stringify(read.diffs[0])} ${JSON.stringify(read.build)}`,
          )
        return read
      },
      { timeout: 30_000, interval: 200 },
    )
    const item = detail.diffs[0]
    hashes.head = item?.head?.sha256 ?? ''
    hashes.base = item?.base?.sha256 ?? ''
    hashes.diff = item?.diff?.sha256 ?? ''
    hashes.thumb = item?.head?.thumbnail ?? ''

    // A hosted site's asset: in the same files table, but never something this route may serve.
    await setup.session.patch(`/api/projects/${workspace()}/${project.slug}/settings`, {
      staticHostingEnabled: true,
    })
    const page = `<!doctype html><h1>asset ${randomBytes(6).toString('hex')}</h1>`
    siteDir = await makeSiteDir({ 'index.html': page })
    const up = await uploadSiteCli({
      stack,
      token: project.token,
      repo,
      dir: siteDir,
      name: 'docs',
    })
    if (up.exitCode !== 0) throw new Error(`site upload failed: ${up.stderr}`)
    assetHash = sha256(page)
  })
  afterAll(async () => {
    await repo.destroy()
    if (siteDir) await rm(siteDir, { recursive: true, force: true })
  })

  it('every screenshot, baseline, diff and thumbnail of a build comes with a signature', () => {
    for (const [what, hash] of Object.entries(hashes)) {
      expect(hash, `the ${what} of the build`).toMatch(/^[0-9a-f]{64}$/)
      expect(detail.fileSignatures?.[hash], `a signature for the ${what}`).toMatch(/^\d+\.[\w-]+$/)
    }
    // The site asset is not a file reference of this reply: no signature.
    expect(detail.fileSignatures?.[assetHash]).toBeUndefined()
  })

  it('loads through the signed link without a cookie, with the right bytes and headers', async () => {
    for (const [what, hash] of Object.entries(hashes)) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of files
      const res = await anonymous(hash, link(hash))
      expect(res.status, `the ${what}`).toBe(200)
      expect(res.headers.get('content-type'), what).toMatch(/^image\/(png|webp)$/)
      // oxlint-disable-next-line no-await-in-loop -- a handful of files
      const bytes = Buffer.from(await res.arrayBuffer())
      // A content address: the bytes served are the bytes the hash names.
      expect(sha256(bytes), `the bytes of the ${what}`).toBe(hash)
      expect(res.headers.get('x-content-type-options'), what).toBe('nosniff')
      expect(res.headers.get('content-security-policy'), what).toBe("sandbox; default-src 'none'")
      expect(res.headers.get('etag'), what).toBe(`"${hash}"`)
    }
  })

  it('caches for no longer than the link stays valid', async () => {
    const hash = hashes.head
    const exp = Number(new URLSearchParams(link(hash)).get('exp'))
    const res = await anonymous(hash, link(hash))
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1])
    const left = exp - Math.floor(Date.now() / 1000)
    expect(res.headers.get('cache-control')).toMatch(/^private, max-age=\d+$/)
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThanOrEqual(left)
    // A link is good for between one and two windows.
    expect(left).toBeLessThanOrEqual(2 * FILE_URL_WINDOW_SECONDS)

    // The same link, asked again with the validator: answered without a body.
    const again = await anonymous(hash, link(hash), { 'if-none-match': `"${hash}"` })
    expect(again.status).toBe(304)
  })

  it('refuses a missing, tampered, mismatched or expired signature when there is no session', async () => {
    const hash = hashes.head
    const [exp = '', sig = ''] = link(hash).slice(1).split('&')
    const cases: Record<string, string> = {
      'no signature': '',
      'a tampered signature': `?${exp}&sig=${flip(sig.slice(4))}`,
      'a signature of nothing': `?${exp}&sig=`,
      'a tampered expiry (later)': `?exp=${Number(exp.slice(4)) + FILE_URL_WINDOW_SECONDS}&${sig}`,
      "another file's signature": link(hashes.base),
      'an expired signature': (() => {
        const old = signFileUrl(STACK_SECRET, hash, {
          now: Date.now() - 4 * FILE_URL_WINDOW_SECONDS * 1000,
        })
        return `?exp=${old.exp}&sig=${old.sig}`
      })(),
      'a signature made with another secret': (() => {
        const forged = signFileUrl('not-the-instance-secret', hash)
        return `?exp=${forged.exp}&sig=${forged.sig}`
      })(),
    }
    // The base's signature only differs from the head's in the hash it covers.
    expect(link(hashes.base)).not.toBe(link(hash))
    for (const [what, query] of Object.entries(cases)) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of requests
      const res = await anonymous(hash, query)
      expect(res.status, what).toBe(401)
      expect(res.headers.get('content-type'), what).not.toMatch(/^image\//)
    }
  })

  it('an expired signature falls back to the session, so a page left open keeps working', async () => {
    const hash = hashes.head
    const old = signFileUrl(STACK_SECRET, hash, {
      now: Date.now() - 4 * FILE_URL_WINDOW_SECONDS * 1000,
    })
    const res = await ctx.setup.session.request('GET', path(hash, `?exp=${old.exp}&sig=${old.sig}`))
    expect(res.status).toBe(200)
    // Through the session the access query ran, and the cache window is a fixed one.
    expect(res.headers.get('cache-control')).toBe(`private, max-age=${FILE_URL_WINDOW_SECONDS}`)
  })

  it('a member of another workspace has no access without a signature', async () => {
    const outsider = await ctx.tenant()
    const res = await outsider.session.request('GET', path(hashes.head))
    expect(res.status).toBe(404)
  })

  it("a site asset's hash can't be fetched through /api/files, even signed correctly or with a session", async () => {
    expect((await fileRows(ctx.stack, `sha256 = '${assetHash}'`))[0]?.kind).toBe('asset')
    const forged = signFileUrl(STACK_SECRET, assetHash)
    const valid = `?exp=${forged.exp}&sig=${forged.sig}`
    expect((await anonymous(assetHash, valid)).status).toBe(404)
    expect((await ctx.setup.session.request('GET', path(assetHash))).status).toBe(404)
    expect((await ctx.setup.session.request('GET', path(assetHash, valid))).status).toBe(404)
  })

  it('a comment that contains a file hash gets no signature for it', async () => {
    const { session } = ctx.setup
    const name = detail.diffs[0]?.name ?? 'home'
    const text = `see ${assetHash} and ${hashes.base} and sha256 ${'ab'.repeat(32)}`
    await session.post(
      `/api/projects/${workspace()}/${project.slug}/builds/${buildNumber}/comments`,
      { body: text, snapshotName: name },
    )
    const raw = await session.get<Comment.List & { fileSignatures?: unknown }>(
      `/api/projects/${workspace()}/${project.slug}/builds/${buildNumber}/comments`,
    )
    expect(raw.comments.some((c) => c.body === text)).toBe(true)
    // Text a user wrote is never a file reference: the reply carries no signatures at all.
    expect(raw.fileSignatures).toBeUndefined()
    // And the build page, fetched again with the comment in place, still signs only its files.
    const again = await session.get<Signed>(
      `/api/projects/${workspace()}/${project.slug}/builds/${buildNumber}`,
    )
    expect(Object.keys(again.fileSignatures ?? {}).toSorted()).toEqual(
      Object.keys(detail.fileSignatures ?? {}).toSorted(),
    )
    expect(again.fileSignatures?.[assetHash]).toBeUndefined()
  })
})
