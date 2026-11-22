import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { FakeCirci, type FakeCirciOptions } from '@circi/testing/hosts'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { UsageError } from '#src/errors.ts'
import { packSite, uploadSite } from '#src/site.ts'

let root: string
let site: string
let fake: FakeCirci

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'circi-cli-site-'))
  site = join(root, 'site')
  await mkdir(site)
  await writeFile(join(site, 'index.html'), '<h1>hi</h1>')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})
afterEach(async () => {
  await fake?.stop()
})

const env = {
  GITLAB_CI: 'true',
  CI_COMMIT_SHA: 'e'.repeat(40),
  CI_COMMIT_BRANCH: 'main',
}

async function run(options: Partial<uploadSite.Options> = {}, server: FakeCirciOptions = {}) {
  fake = await new FakeCirci(server).start()
  const lines: string[] = []
  const result = await uploadSite({
    dir: site,
    apiUrl: fake.url,
    token: 'circi_t',
    cwd: root,
    env,
    log: (l) => void lines.push(l),
    ...options,
  })
  return { result, lines }
}

describe('packSite', () => {
  it('packs a directory as a gzipped tar with its files in it', async () => {
    const archive = await packSite(site)
    expect(gunzipSync(archive).toString('latin1')).toContain('index.html')
  })

  it('refuses something that is not a directory', async () => {
    await expect(packSite(join(site, 'index.html'))).rejects.toThrow(UsageError)
    await expect(packSite(join(root, 'missing'))).rejects.toThrow(/is not a directory/)
  })

  it('refuses symbolic links, naming them', async () => {
    const linked = join(root, 'linked')
    await mkdir(linked)
    await writeFile(join(linked, 'a.html'), 'a')
    await symlink('/etc/passwd', join(linked, 'passwd'))
    await expect(packSite(linked)).rejects.toThrow(/symbolic links or special files.*passwd/)
  })
})

describe('uploadSite', () => {
  it('uploads the archive with what and where, and prints the addresses', async () => {
    const { result, lines } = await run({ name: 'storybook', spa: true })
    const [request] = fake.to('/v1/sites?')
    const query = new URL(`http://x${request?.path}`).searchParams
    expect(Object.fromEntries(query)).toMatchObject({
      name: 'storybook',
      kind: 'auto',
      commit: 'e'.repeat(40),
      branch: 'main',
      spa: 'true',
      // Nothing is served on this branch yet, so the commit starts it.
      descends: 'true',
    })
    expect(request?.headers.authorization).toBe('Bearer circi_t')
    expect(request?.headers['content-type']).toBe('application/gzip')
    expect(result.archiveBytes).toBe(request?.body.length)
    expect(lines.join('\n')).toContain('storybook (storybook): 2 files')
    expect(lines.join('\n')).toContain('branch:  https://main-web.sites.test')
  })

  it('does not claim the branch when what it serves is not an ancestor', async () => {
    await run({}, { servedCommit: 'd'.repeat(40) })
    const query = new URL(`http://x${fake.to('/v1/sites?')[0]?.path}`).searchParams
    expect(query.has('descends')).toBe(false)
  })

  it("leaves descends unset when it can't ask what the branch serves, and says so", async () => {
    const { lines } = await run(
      { retryDelayMs: 1 },
      { failFirst: [{ match: 'GET /v1/sites/served', status: 500, times: 99 }] },
    )
    const query = new URL(`http://x${fake.to('/v1/sites?')[0]?.path}`).searchParams
    expect(query.has('descends')).toBe(false)
    // It was asked more than once (retried), and the upload still went ahead.
    expect(fake.to('/v1/sites/served').length).toBeGreaterThan(1)
    expect(lines.join('\n')).toContain("couldn't ask what main serves now")
  })

  it('retries the question and uses the answer when the server recovers', async () => {
    await run(
      { retryDelayMs: 1 },
      { failFirst: [{ match: 'GET /v1/sites/served', status: 503, times: 2 }] },
    )
    const query = new URL(`http://x${fake.to('/v1/sites?')[0]?.path}`).searchParams
    // Recovered with "nothing served yet": the explicit null, so the commit starts the branch.
    expect(query.get('descends')).toBe('true')
  })

  it('refuses without a commit', async () => {
    fake = await new FakeCirci().start()
    await expect(
      uploadSite({ dir: site, apiUrl: fake.url, token: 't', cwd: root, env: {} }),
    ).rejects.toThrow(/Could not determine the commit/)
  })
})
