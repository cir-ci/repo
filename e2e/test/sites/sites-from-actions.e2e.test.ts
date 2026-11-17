import type { Site } from '@circi/api'
import { makeZip } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '#clients/admin.ts'
import { siteCookieFor, siteRequest } from '#clients/sites.ts'
import { type FakeGithub, startFakeGithub } from '#fakes/fake-github.ts'
import { uniqueInstallationId } from '#github/github-helpers.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * Sites from GitHub Actions through the real stack: a signed `workflow_run` webhook reaches the
 * server, the worker downloads the run's artifact from the fake GitHub (through the signed
 * redirect, without the token) and publishes it, and the site is served at its commit and branch
 * addresses behind sign-in. GitHub is a fake on the host: nothing here ran against github.com.
 */
describe('sites from GitHub Actions artifacts (fake GitHub)', () => {
  let gh: FakeGithub
  // Registered before useStack's own hook, so the fake exists when the stack's environment is read.
  beforeAll(async () => {
    gh = await startFakeGithub({ pathPrefix: '/api/v3' })
  })
  afterAll(async () => {
    await gh.close()
  })
  const ctx = useStack({
    dedicated: true,
    setup: true,
    sitesHost: 'sites.localhost',
    env: () => ({ ...gh.env(), STATIC_SITES_MAX_MB: '1' }),
  })

  let project: CreatedProject
  let workspace = ''
  let installationId = ''
  const REPO = 'acme/docs-site'
  const SHA = '1234567890abcdef1234567890abcdef12345678'
  const base = () => `/api/projects/${workspace}/${project.slug}`

  const run = (id: number, over: Record<string, unknown> = {}) => ({
    action: 'completed',
    workflow_run: {
      id,
      run_attempt: 1,
      conclusion: 'success',
      head_sha: SHA,
      head_branch: 'main',
      pull_requests: [],
      head_repository: { full_name: REPO },
      ...over,
    },
    installation: { id: Number(installationId) },
    repository: { full_name: REPO },
  })
  const sites = async () =>
    (await ctx.setup.session.get<{ sites: Site.Listing[] }>(`${base()}/sites`)).sites
  const lastResult = async () =>
    (
      await ctx.setup.session.get<{
        sitesFromActionsResult: { status: string; message: string } | null
      }>(`${base()}/settings`)
    ).sitesFromActionsResult

  const count = async (where: string) =>
    String(
      (
        await ctx.stack.sql(`select count(*) from jobs where queue = 'site-artifact' and ${where}`)
      )[0]?.[0],
    )
  const openJobs = () => count("status in ('pending', 'running')")
  const jobsOfRun = (runId: string) => count(`payload->>'runId' = '${runId}'`)

  beforeAll(async () => {
    const { setup } = ctx
    workspace = setup.workspace.slug
    installationId = uniqueInstallationId()
    project = await createProject(setup.session, workspace, 'Docs site')
    await setup.session.put(`${base()}/github`, { installationId, repoRef: REPO })
    await setup.session.patch(`${base()}/settings`, {
      staticHostingEnabled: true,
      sitesFromActions: true,
    })
  })

  it('publishes the artifact at the commit and branch addresses, and serves it behind sign-in', async () => {
    const { stack, setup } = ctx
    gh.addArtifact(9001, {
      name: 'circi-site',
      zip: makeZip([
        { name: 'index.html', content: '<h1>from actions</h1>' },
        { name: 'assets/', type: 'dir' },
        { name: 'assets/app.js', content: 'console.log(1)' },
      ]),
    })
    const delivery = await gh.sendWebhook(stack.url, 'workflow_run', run(9001), {
      deliveryId: 'wf-9001',
    })
    expect(delivery.status).toBe(200)

    await expect.poll(async () => (await sites()).length, { timeout: 30_000 }).toBe(1)
    const [site] = await sites()
    expect(site).toMatchObject({ name: 'site', kind: 'generic' })
    expect(site?.versions[0]).toMatchObject({ commitSha: SHA, branch: 'main' })
    const commitAddress = site?.versions[0]?.address
    const branchAddress = site?.branches.find((b) => b.branch === 'main')?.address
    expect(commitAddress).toBeTruthy()
    expect(branchAddress).toBeTruthy()

    for (const address of [commitAddress ?? '', branchAddress ?? '']) {
      const { cookie } = await siteCookieFor(stack, setup.session, address)
      expect((await siteRequest(stack, address, '/', { cookie })).text).toContain('from actions')
      expect((await siteRequest(stack, address, '/assets/app.js', { cookie })).text).toBe(
        'console.log(1)',
      )
      // Without the sign-in cookie nothing is served.
      expect((await siteRequest(stack, address, '/')).status).not.toBe(200)
    }
    expect(await lastResult()).toMatchObject({ status: 'published' })
    // The artifact came from the signed address, which was never sent the installation token.
    expect(gh.signedDownloadsHadAuth()).toEqual([false])
    const api = gh.find('/actions/artifacts/')
    expect(api.every((r) => r.auth === 'installation')).toBe(true)
    // No token reached the logs.
    const logs = await stack.logs('circi')
    expect(gh.issuedTokens().length).toBeGreaterThan(0)
    for (const token of gh.issuedTokens()) expect(logs).not.toContain(token)
  })

  it('handles a redelivery once: same delivery or same run does not publish again', async () => {
    const { stack } = ctx
    const before = gh.find('/actions/runs/9001/artifacts').length
    const replay = await gh.sendWebhook(stack.url, 'workflow_run', run(9001), {
      deliveryId: 'wf-9001',
    })
    expect(replay.body).toContain('duplicate')
    // A manual redelivery has a new delivery ID: the run attempt was already published.
    await gh.sendWebhook(stack.url, 'workflow_run', run(9001), { deliveryId: 'wf-9001-again' })
    // The webhook queues its job before answering: once none is pending or running, both ran.
    await expect.poll(() => openJobs(), { timeout: 30_000 }).toBe('0')
    expect(gh.find('/actions/runs/9001/artifacts')).toHaveLength(before)
    expect((await sites())[0]?.versions).toHaveLength(1)
  })

  it('does not move the branch address for a run that is not the branch tip', async () => {
    const { stack } = ctx
    const older = 'a'.repeat(40)
    gh.setBranchTip(REPO, 'main', SHA)
    gh.addArtifact(9002, {
      name: 'circi-site',
      zip: makeZip([{ name: 'index.html', content: '<h1>older</h1>' }]),
    })
    await gh.sendWebhook(stack.url, 'workflow_run', run(9002, { head_sha: older }))
    await expect.poll(async () => (await sites())[0]?.versions.length, { timeout: 30_000 }).toBe(2)
    const [site] = await sites()
    expect(site?.branches.find((b) => b.branch === 'main')?.commitSha).toBe(SHA)
  })

  it('notes what is wrong when the artifact is missing, and when it is too big', async () => {
    const { stack } = ctx
    await gh.sendWebhook(stack.url, 'workflow_run', run(9003, { head_sha: 'b'.repeat(40) }))
    await expect
      .poll(async () => (await lastResult())?.message, { timeout: 30_000 })
      .toContain('no artifact named "circi-site"')
    expect(await lastResult()).toMatchObject({ status: 'failed' })

    // 1 MB limit on this stack: a 2 MB file of random-looking bytes, stored.
    const big = Buffer.alloc(2 * 1024 * 1024, 7)
    gh.addArtifact(9004, {
      name: 'circi-site',
      zip: makeZip([{ name: 'index.html', content: big, stored: true }]),
    })
    await gh.sendWebhook(stack.url, 'workflow_run', run(9004, { head_sha: 'c'.repeat(40) }))
    await expect
      .poll(async () => (await lastResult())?.message, { timeout: 30_000 })
      .toMatch(/above this instance's limit/)
  })

  it('ignores a run that failed, and does nothing once the setting is off', async () => {
    const { stack, setup } = ctx
    gh.addArtifact(9005, {
      name: 'circi-site',
      zip: makeZip([{ name: 'index.html', content: 'x' }]),
    })
    await gh.sendWebhook(
      stack.url,
      'workflow_run',
      run(9005, { conclusion: 'failure', head_sha: 'd'.repeat(40) }),
    )
    await setup.session.patch(`${base()}/settings`, { sitesFromActions: false })
    await gh.sendWebhook(stack.url, 'workflow_run', run(9005, { head_sha: 'd'.repeat(40) }))
    // Nothing was even queued for it (the job's payload carries the run ID).
    expect(await jobsOfRun('9005')).toBe('0')
    expect(gh.find('/actions/runs/9005/artifacts')).toHaveLength(0)
  })
})
