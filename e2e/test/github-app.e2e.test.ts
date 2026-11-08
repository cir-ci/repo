import { beforeAll, describe, expect, it } from 'vitest'

import { createProject } from '../src/admin.ts'
import type { FakeGithub } from '../src/fakes/fake-github.ts'
import {
  buildDetail,
  checkRunPayload,
  createLinkedProject,
  INSTALLATION,
  type LinkedProject,
  uploadPr,
} from '../src/github-helpers.ts'
import { useBrowser, useStack } from '../src/vitest.ts'

/**
 * The GitHub App against the real stack. GitHub itself is a fake on the host (`fake-github.ts`,
 * the same fake the real `GithubApp` is unit-tested against): nothing here proves CirCI against
 * the real github.com. `GITHUB_API_URL` points at the fake under `/api/v3`, as for GitHub Enterprise.
 */
describe('GitHub App: linking, webhook intake, check run and comment', () => {
  let gh: FakeGithub
  const ctx = useStack({ profile: 'github', setup: true })
  // The profile's fake GitHub, reset for this file. Registered right after useStack's own hooks.
  beforeAll(() => {
    gh = ctx.github
  })
  const browser = useBrowser()
  let linked: LinkedProject
  let orgSlug = ''

  const deliveries = async () =>
    Number((await ctx.stack.sql('select count(*) from provider_deliveries'))[0]?.[0])

  it('connects GitHub in Integrations, links a repository to a project there and unlinks it', async () => {
    const { stack, setup } = ctx
    orgSlug = setup.organization.slug
    const project = await createProject(setup.session, orgSlug, 'Linked in UI')
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/organizations/${orgSlug}/settings/integrations`)
    await page.getByRole('button', { name: 'Add integration' }).click()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    await page.getByLabel('GitHub App installation id').fill(INSTALLATION)
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    // The GitHub integration's page shows the webhook address CirCI expects on the GitHub App.
    await page.getByText(`${stack.url}/webhooks/github`).waitFor()
    await page.getByLabel('Linked in UI repository').fill('acme/ui-linked')
    await page
      .getByRole('form', { name: 'Linked in UI' })
      .getByRole('button', { name: 'Link' })
      .click()
    await page.getByRole('button', { name: 'Unlink' }).waitFor()

    const settings = await setup.session.get<{
      github: { configured: boolean; link: { installationId: string; repoRef: string } | null }
    }>(`/api/projects/${orgSlug}/${project.slug}/settings`)
    expect(settings.github).toMatchObject({
      configured: true,
      link: { installationId: INSTALLATION, repoRef: 'acme/ui-linked' },
    })
    // Survives a reload; and unlinking works.
    await page.reload()
    await page.getByLabel('Linked in UI repository').waitFor()
    await page.getByRole('button', { name: 'Unlink' }).click()
    await page.getByRole('button', { name: 'Link', exact: true }).waitFor()
    const after = await setup.session.get<{ github: { link: unknown } }>(
      `/api/projects/${orgSlug}/${project.slug}/settings`,
    )
    expect(after.github.link).toBeNull()
  })

  it('refuses a malformed repository or installation id', async () => {
    const { setup } = ctx
    const project = await createProject(setup.session, orgSlug, 'Bad link')
    const bad = await setup.session.request(
      'PUT',
      `/api/projects/${orgSlug}/${project.slug}/github`,
      {
        installationId: 'abc',
        repoRef: 'nope',
      },
    )
    expect(bad.status).toBe(400)
  })

  it('rejects a bad or missing signature with no side effects, and accepts a signed one', async () => {
    const { stack, setup } = ctx
    linked = await createLinkedProject(stack, setup.session, orgSlug, 'Web', {
      repoRef: 'acme/web',
      blockMergeOnChanges: true,
    })
    const before = await deliveries()
    const requests = gh.requests.length
    const payload = checkRunPayload(1, 'acme/web', 'approve', { id: 9, login: 'x' })

    const wrong = await gh.sendWebhook(stack.url, 'check_run', payload, {
      secret: 'not-the-secret',
    })
    expect(wrong.status).toBe(401)
    const unsigned = await fetch(`${stack.url}/webhooks/github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'check_run',
        'x-github-delivery': 'd1',
      },
      body: JSON.stringify(payload),
    })
    expect(unsigned.status).toBe(401)
    expect(await deliveries()).toBe(before)
    expect(gh.requests.length).toBe(requests)

    const ok = await gh.sendWebhook(stack.url, 'check_run', payload)
    expect(ok.status).toBe(200)
    expect(await deliveries()).toBe(before + 1)
  })

  it('acknowledges installation, pull_request and push events without doing anything', async () => {
    const { stack } = ctx
    const requests = gh.requests.length
    const reviews = (await ctx.stack.sql('select count(*) from reviews'))[0]?.[0]
    for (const [event, payload] of [
      ['installation', { action: 'created', installation: { id: Number(INSTALLATION) } }],
      ['pull_request', { action: 'opened', number: 5, repository: { full_name: 'acme/web' } }],
      ['pull_request', { action: 'synchronize', number: 5, repository: { full_name: 'acme/web' } }],
      ['pull_request', { action: 'closed', number: 5, repository: { full_name: 'acme/web' } }],
      ['push', { ref: 'refs/heads/main', repository: { full_name: 'acme/web' } }],
      ['ping', { zen: 'Keep it logically awesome.' }],
    ] as const) {
      const res = await gh.sendWebhook(stack.url, event, payload)
      expect([event, res.status]).toEqual([event, 200])
    }
    // Malformed commands and payloads are ignored, not errors.
    expect((await gh.sendWebhook(stack.url, 'issue_comment', { action: 'created' })).status).toBe(
      200,
    )
    expect(gh.requests.length).toBe(requests)
    expect((await ctx.stack.sql('select count(*) from reviews'))[0]?.[0]).toBe(reviews)
  })

  it('a replayed delivery id is handled once', async () => {
    const { stack } = ctx
    const first = await gh.sendWebhook(stack.url, 'ping', { zen: 'x' }, { deliveryId: 'replay-1' })
    const again = await gh.sendWebhook(stack.url, 'ping', { zen: 'x' }, { deliveryId: 'replay-1' })
    expect(first.status).toBe(200)
    expect(JSON.parse(again.body)).toMatchObject({ ok: true, duplicate: true })
    expect(JSON.parse(first.body).duplicate).toBeUndefined()
  })

  it('a PR build creates the CirCI check run (in progress, then completed) and one comment', async () => {
    const { stack, setup } = ctx
    gh.clear()
    const pr = await uploadPr(stack, linked, 21, { login: { dot: { x: 300, y: 200 } } })
    // With a linked repository the check is the gate: the CLI waits, then exits 0.
    expect(pr.exitCode).toBe(0)

    await expect
      .poll(() => gh.checkRuns.find((c) => c.headSha === pr.sha)?.conclusion)
      .toBe('action_required')
    const runs = gh.checkRuns.filter((c) => c.headSha === pr.sha)
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(run).toMatchObject({
      repo: 'acme/web',
      name: `CirCI / ${(await buildDetail(setup.session, linked, pr.buildNumber)).build.name}`,
      status: 'completed',
      title: '1 changed: review required',
    })
    expect(run.summary).toContain('Approve or reject the changes here')
    expect(run.summary).toContain(`/${orgSlug}/${linked.slug}/builds/${pr.buildNumber}`)
    expect(run.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
    // It was announced as in progress before it completed (create, then patches).
    const statuses = run.history.map((h) => (h as { status?: string }).status)
    expect(statuses[0]).toBe('in_progress')
    expect(statuses.at(-1)).toBe('completed')
    // Only the check run's PATCHes reuse its id: no second check run was created.
    expect(
      gh
        .find('POST /repos/acme/web/check-runs')
        .filter((r) => (r.body as { head_sha: string }).head_sha === pr.sha),
    ).toHaveLength(1)
    // Every call went to the configured Enterprise-style base URL (the fake rejects other paths),
    // with a token minted from the app JWT.
    expect(gh.issuedTokens().length).toBeGreaterThan(0)
    expect(gh.find('POST /repos/acme/web/check-runs')[0]?.auth).toBe('installation')
    expect(gh.requests.every((r) => r.auth === 'app' || r.auth === 'installation')).toBe(true)

    await expect.poll(() => gh.comments.filter((c) => c.prNumber === 21).length).toBe(1)
    const comment = gh.comments.find((c) => c.prNumber === 21)!
    expect(comment.body).toContain('<!-- circi:pr-summary -->')
    expect(comment.body).toContain('Changes detected')
    expect(comment.body).toContain('/circi approve')
  })

  it('a re-run on the same pull request updates the one comment instead of adding another', async () => {
    const { stack } = ctx
    const pr = await uploadPr(stack, linked, 21, { login: { dot: { x: 310, y: 210 } } })
    expect(pr.exitCode).toBe(0)
    await expect
      .poll(() => gh.checkRuns.find((c) => c.headSha === pr.sha)?.status)
      .toBe('completed')
    await expect
      .poll(() =>
        gh.comments.find((c) => c.prNumber === 21)?.body.includes(`builds/${pr.buildNumber})`),
      )
      .toBe(true)
    expect(gh.comments.filter((c) => c.prNumber === 21)).toHaveLength(1)
    expect(gh.find('POST /repos/acme/web/issues/21/comments')).toHaveLength(1)
    expect(gh.find('PATCH /repos/acme/web/issues/comments/').length).toBeGreaterThan(0)
  })

  it('a 401 for the installation puts a banner on the project and its settings, until the link is saved again', async () => {
    const { stack, setup } = ctx
    // An installation of its own: the others in this file keep working.
    const REVOKED = '9191'
    const p = await createLinkedProject(stack, setup.session, orgSlug, 'Revoked', {
      repoRef: 'acme/revoked',
      installationId: REVOKED,
    })
    const projectUrl = `${stack.url}/${orgSlug}/${p.slug}`
    const attention = async () =>
      (await setup.session.get<{ gitAttention: unknown }>(`/api/projects/${orgSlug}/${p.slug}`))
        .gitAttention
    expect(await attention()).toBeNull()

    gh.revokeInstallation(REVOKED)
    const pr = await uploadPr(stack, p, 31, { login: { dot: { x: 20, y: 20 } } })
    await expect.poll(attention, { timeout: 30_000 }).toMatchObject({
      reason: 'installation_revoked',
    })
    // No retries pile up: the job is done, and GitHub saw no check run for it.
    await expect
      .poll(
        async () => [
          ...new Set(
            (
              await stack.sql(
                `select status from jobs where queue = 'git-notify' and payload->>'buildId' = '${pr.buildId}'`,
              )
            ).map((r) => r[0]),
          ),
        ],
        { timeout: 30_000 },
      )
      .toEqual(['done'])
    expect(gh.checkRuns.find((c) => c.headSha === pr.sha)).toBeUndefined()

    const page = await browser.as(setup.session)
    await page.goto(projectUrl)
    await page.getByText(/can.t reach GitHub for this project/).waitFor()
    await page.getByText(/GitHub App was removed or suspended/).waitFor()
    await page.goto(`${projectUrl}/settings`)
    await page.getByText(/can.t reach GitHub for this project/).waitFor()

    // Reinstalled: saving the repository again on the GitHub integration's page clears the banner.
    gh.restoreInstallation(REVOKED)
    await page.goto(`${stack.url}/organizations/${orgSlug}/settings/integrations/github`)
    await page
      .getByRole('form', { name: 'Revoked' })
      .getByRole('button', { name: 'Update' })
      .click()
    await page.goto(`${projectUrl}/settings`)
    await page.getByText(/can.t reach GitHub for this project/).waitFor({ state: 'detached' })
    expect(await attention()).toBeNull()
    await page.goto(projectUrl)
    await page.getByRole('heading', { name: 'Builds' }).waitFor()
    expect(await page.getByText(/can.t reach GitHub for this project/).count()).toBe(0)
  })

  it('tokens and the private key never reach the logs', async () => {
    const logs = await ctx.stack.logs('circi')
    expect(logs).not.toContain('BEGIN PRIVATE KEY')
    expect(logs).not.toContain(gh.privateKey.split('\n')[1] ?? 'unreachable')
    expect(logs).not.toContain(gh.webhookSecret)
    const tokens = gh.issuedTokens()
    expect(tokens.length).toBeGreaterThan(0)
    for (const t of tokens) expect(logs).not.toContain(t)
    // The app JWT neither.
    const jwt = gh.find('POST /app/installations')[0]?.headers['authorization']
    expect(typeof jwt === 'string' ? logs.includes(jwt.replace('Bearer ', '')) : false).toBe(false)
  })
})
