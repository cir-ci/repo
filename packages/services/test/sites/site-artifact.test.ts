import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Job } from '@circi/db'
import { latestArtifactImport, servedCommitForBranch, sitesForCommit } from '@circi/db/queries'
import { SITE_ARTIFACT_QUEUE } from '@circi/db/queue'
import { updateProjectSettings } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb, seedGitLink, seedProject } from '@circi/db/testing'
import { type IntegrationDefinition, integrationRegistry } from '@circi/integrations'
import { FsStorage } from '@circi/storage'
import { makeZip, type ZipEntry } from '@circi/testing'
import { fakeGithubHost } from '@circi/testing/hosts'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { handleGitEvents, importSiteArtifact, noteSiteArtifactGiveUp } from '#src/index.ts'

/**
 * The job that publishes a site from a GitHub Actions artifact. GitHub is faked at its HTTP edge
 * (artifact list, signed download); the database, the zip reader and the publishing are real.
 */

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

let t: createTestDb.Result
let dir: string
let storage: FsStorage
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'circi-site-artifact-'))
  storage = new FsStorage({ path: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const SHA = 'abcdef0123456789abcdef0123456789abcdef01'
const site = (extra: ZipEntry[] = []) =>
  makeZip([{ name: 'index.html', content: '<h1>hello</h1>' }, ...extra])

let seq = 0
async function world(settings: { on?: boolean; hosting?: boolean } = {}) {
  seq += 1
  const repoRef = `acme/web-${seq}`
  const installationId = `9${seq}`
  const { project, workspace } = await seedProject(t.db)
  await seedGitLink(t.db, project.id, { externalId: installationId, repoRef })
  await updateProjectSettings(t.db, project.id, {
    staticHostingEnabled: settings.hosting ?? true,
    sitesFromActions: settings.on ?? true,
  })
  const fake = fakeGithubHost({ installationId, repos: [repoRef] })
  const options = { apiUrl: 'https://api.github.test', appId: '4242', privateKey }
  const context: IntegrationDefinition.Context = {
    authSecret: 's',
    publicOrigin: 'https://ci.test',
    config: { github: { ...options, webhookSecret: 'w' } },
    fetch: fake.fetcher,
  }
  return { project, workspace, repoRef, installationId, fake, context }
}

type World = Awaited<ReturnType<typeof world>>

const payload = (w: World, over: Record<string, unknown> = {}) => ({
  projectId: w.project.id,
  kind: 'github',
  externalId: w.installationId,
  repo: w.repoRef,
  runId: '500',
  runAttempt: 1,
  headSha: SHA,
  headBranch: 'main',
  fork: false,
  ...over,
})

const jobOf = (body: Record<string, unknown>): Job => ({
  id: 1,
  queue: SITE_ARTIFACT_QUEUE,
  payload: body,
  dedupeKey: null,
  status: 'running',
  attempts: 1,
  maxAttempts: 5,
  runAt: new Date(),
  lockedUntil: null,
  lastError: null,
  createdAt: new Date(),
  finishedAt: null,
})

const run = (w: World, over: Record<string, unknown> = {}, maxBytes = 5 * 1024 * 1024) =>
  importSiteArtifact(
    { db: t.db, storage, context: w.context, maxBytes: async () => maxBytes },
    jobOf(payload(w, over)),
  )

describe('importSiteArtifact', () => {
  it('publishes the artifact as a site for the run commit and branch', async () => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site() })
    expect(await run(w)).toMatchObject({ status: 'published', files: 1, commitSha: SHA })

    const sites = await sitesForCommit(t.db, w.project.id, SHA)
    expect(sites).toMatchObject([{ name: 'site', kind: 'generic' }])
    expect(sites[0]?.commitLabel).toBeTruthy()
    // Nothing served the branch yet, so it takes the address.
    expect(await servedCommitForBranch(t.db, w.project.id, 'site', 'main')).toBe(SHA)
    expect(await latestArtifactImport(t.db, w.project.id)).toMatchObject({
      status: 'published',
      runId: '500',
    })
    // The signed download never carried the installation token.
    expect(w.fake.host.signedDownloadsHadAuth()).toEqual([false])
  })

  it('uses the configured artifact and site names', async () => {
    const w = await world()
    await updateProjectSettings(t.db, w.project.id, {
      sitesArtifactName: 'storybook',
      sitesArtifactSiteName: 'storybook',
    })
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site() })
    w.fake.host.addArtifact(500, { name: 'storybook', zip: site() })
    expect((await run(w)).status).toBe('published')
    expect((await sitesForCommit(t.db, w.project.id, SHA)).map((s) => s.name)).toEqual([
      'storybook',
    ])
  })

  it('is idempotent per run attempt, and a re-run (a new attempt) publishes again', async () => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site() })
    expect((await run(w)).status).toBe('published')
    const before = w.fake.calls.length
    expect(await run(w)).toEqual({ status: 'skipped', reason: 'this run was already published' })
    // The second job didn't even ask GitHub.
    expect(w.fake.calls).toHaveLength(before)
    expect((await run(w, { runAttempt: 2 })).status).toBe('published')
  })

  it('moves the branch address only to the branch tip, never for a fork', async () => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site() })
    const tip = 'f'.repeat(40)
    w.fake.script('GET /repos/' + w.repoRef + '/git/ref/heads/main', { object: { sha: tip } })
    await run(w)
    // This run isn't the tip: it has a commit address but didn't take the branch.
    expect(await servedCommitForBranch(t.db, w.project.id, 'site', 'main')).toBeUndefined()

    w.fake.host.addArtifact(501, { name: 'circi-site', zip: site() })
    await run(w, { runId: '501', fork: true, headSha: '1'.repeat(40), headBranch: 'feature' })
    expect(await servedCommitForBranch(t.db, w.project.id, 'site', 'feature')).toBeUndefined()
  })

  it.each([
    ['is missing', undefined, /no artifact named "circi-site"/],
    ['has expired', { expired: true }, /has expired/],
  ])('records a note when the artifact %s', async (_what, options, message) => {
    const w = await world()
    if (options) w.fake.host.addArtifact(500, { name: 'circi-site', zip: site(), ...options })
    else w.fake.host.addArtifact(500, { name: 'other', zip: site() })
    const result = await run(w)
    expect(result.status).toBe('failed')
    expect(await latestArtifactImport(t.db, w.project.id)).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(message),
    })
    expect(await sitesForCommit(t.db, w.project.id, SHA)).toEqual([])
  })

  it('refuses an artifact above the instance limit', async () => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site() })
    expect((await run(w, {}, 20)).status).toBe('failed')
    expect((await latestArtifactImport(t.db, w.project.id))?.message).toMatch(
      /above this instance's limit/,
    )
  })

  it.each([
    ['a symlink', [{ name: 'link', type: 'symlink', content: '/etc/passwd' }] as ZipEntry[]],
    ['a path that leaves the site', [{ name: '../evil.html', content: 'x' }] as ZipEntry[]],
  ])('refuses %s and publishes nothing', async (_what, extra) => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: site(extra) })
    expect((await run(w)).status).toBe('failed')
    expect(await sitesForCommit(t.db, w.project.id, SHA)).toEqual([])
  })

  it('refuses something that is not a zip, and a site with no entry page', async () => {
    const w = await world()
    w.fake.host.addArtifact(500, { name: 'circi-site', zip: Buffer.from('not a zip at all, no') })
    expect((await run(w)).status).toBe('failed')
    w.fake.host.addArtifact(501, {
      name: 'circi-site',
      zip: makeZip([{ name: 'readme.txt', content: 'x' }]),
    })
    // No index.html: a generic site needs one.
    const result = await run(w, { runId: '501' })
    expect(result).toMatchObject({ status: 'failed' })
  })

  it('explains a refusal from GitHub (the App lacks Actions: read)', async () => {
    const w = await world()
    w.fake.script(
      `GET /repos/${w.repoRef}/actions/runs/500/artifacts`,
      Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    )
    expect((await run(w)).status).toBe('failed')
    expect((await latestArtifactImport(t.db, w.project.id))?.message).toMatch(/Actions: read/)
  })

  it('retries a GitHub server error (it throws) and notes it when every try failed', async () => {
    const w = await world()
    w.fake.script(
      `GET /repos/${w.repoRef}/actions/runs/500/artifacts`,
      Response.json({ message: 'Bad gateway' }, { status: 502 }),
    )
    await expect(run(w)).rejects.toThrow(/Bad gateway/)
    expect(await latestArtifactImport(t.db, w.project.id)).toBeUndefined()
    await noteSiteArtifactGiveUp(t.db, jobOf(payload(w)), 'Bad gateway')
    expect(await latestArtifactImport(t.db, w.project.id)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('after several tries'),
    })
  })

  it('does nothing when the setting went off since the webhook, or the job is malformed', async () => {
    const w = await world({ on: false })
    expect((await run(w)).status).toBe('skipped')
    expect(w.fake.calls).toHaveLength(0)
    expect(
      await importSiteArtifact(
        { db: t.db, storage, context: w.context, maxBytes: async () => 1 },
        jobOf({ nonsense: true }),
      ),
    ).toEqual({ status: 'skipped', reason: 'malformed job' })
  })
})

const github = integrationRegistry.get('github')
if (!github) throw new Error('the github definition is missing')
const event = (w: World): IntegrationDefinition.GitEvent => ({
  type: 'workflow_run',
  repo: { ref: w.repoRef, connection: { externalId: w.installationId } },
  runId: '500',
  runAttempt: 1,
  headSha: SHA,
  headBranch: 'main',
  fork: false,
})
const queued = async (projectId: string) =>
  (await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, SITE_ARTIFACT_QUEUE))).filter(
    (j) => j.payload.projectId === projectId,
  )

const handle = async (w: World) =>
  handleGitEvents(t.db, {
    definition: github,
    ctx: w.context,
    events: [event(w)],
    log: { info: () => {}, warn: () => {} },
  })

describe('a finished workflow run', () => {
  it('queues one import per project that asked, once for a duplicate event', async () => {
    const w = await world()
    await handle(w)
    await handle(w)
    const jobs = await queued(w.project.id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({
      kind: 'github',
      repo: w.repoRef,
      runId: '500',
      headSha: SHA,
      headBranch: 'main',
      fork: false,
    })
  })

  it('queues nothing for a project with the setting or hosting off', async () => {
    const off = await world({ on: false })
    const noHosting = await world({ hosting: false })
    await handle(off)
    await handle(noHosting)
    expect(await queued(off.project.id)).toEqual([])
    expect(await queued(noHosting.project.id)).toEqual([])
  })
})
