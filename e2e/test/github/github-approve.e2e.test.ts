import { beforeAll, describe, expect, it } from 'vitest'

import { createUserViaCli } from '#clients/admin.ts'
import type { FakeGithub } from '#fakes/fake-github.ts'
import {
  buildDetail,
  checkRunPayload,
  commentPayload,
  createGithubUser,
  createLinkedProject,
  linkGithubIdentity,
  type LinkedProject,
  type PrBuild,
  uploadPr,
} from '#github/github-helpers.ts'
import { useStack } from '#stack/vitest.ts'

// Polls up to 20 s unless told otherwise (vitest's default is 1 s).
const poll = <T>(fn: () => T | Promise<T>, options: { timeout?: number } = {}) =>
  // oxlint-disable-next-line vitest/require-awaited-expect-poll -- returned to callers, who await it
  expect.poll(fn, { timeout: 20_000, ...options })

/**
 * Approving and rejecting from GitHub (check-run buttons and `/circi` comments) and GitHub API
 * failures. GitHub is a fake on the host: nothing here was run against github.com.
 */
describe('approving from GitHub, and GitHub failing (fake GitHub)', () => {
  let gh: FakeGithub
  const ctx = useStack({ profile: 'github', setup: true })
  // The profile's fake GitHub, reset for this file. Registered right after useStack's own hooks.
  beforeAll(() => {
    gh = ctx.github
  })
  let p: LinkedProject
  let workspace = ''
  let n = 50
  const REPO = 'acme/approve'
  const LINKED = { id: 7001, login: 'linked-member' }
  const STRANGER = { id: 7002, login: 'stranger' }
  const OUTSIDER = { id: 7003, login: 'outsider' }

  const checkFor = (sha: string) => gh.checkRuns.find((c) => c.headSha === sha)
  const pending = async (): Promise<PrBuild> => {
    n += 1
    const pr = await uploadPr(ctx.stack, p, n, { login: { dot: { x: 100 + n, y: 100 } } })
    await poll(() => checkFor(pr.sha)?.conclusion).toBe('action_required')
    return pr
  }
  const reviews = async (pr: PrBuild) =>
    (await buildDetail(ctx.setup.session, p, pr.buildNumber)).reviews
  const press = (pr: PrBuild, identifier: 'approve' | 'reject', sender = LINKED) =>
    gh.sendWebhook(
      ctx.stack.url,
      'check_run',
      checkRunPayload(checkFor(pr.sha)?.id ?? 0, REPO, identifier, sender, p.installationId),
    )
  const comment = (pr: PrBuild, body: string, user = LINKED) => {
    const c = gh.seedComment(REPO, pr.number, body)
    return {
      c,
      send: () =>
        gh.sendWebhook(
          ctx.stack.url,
          'issue_comment',
          commentPayload(REPO, pr.number, c.id, body, user, p.installationId),
        ),
    }
  }

  it('sets up a blocking project and three GitHub identities', async () => {
    const { stack, setup } = ctx
    workspace = setup.workspace.slug
    p = await createLinkedProject(stack, setup.session, workspace, 'Approve', {
      repoRef: REPO,
      blockMergeOnChanges: true,
    })
    const member = await createGithubUser(stack, {
      githubUserId: String(LINKED.id),
      workspace,
      projects: [p.slug],
    })
    expect(member.email).toContain('@')
    // Linked to a CirCI account that belongs to no workspace with this project.
    const lonely = await createUserViaCli(stack)
    await linkGithubIdentity(stack, lonely.email, String(OUTSIDER.id))
  })

  it('the Approve button from a linked member approves, records github-check and updates the check', async () => {
    const pr = await pending()
    expect((await press(pr, 'approve')).status).toBe(200)
    await poll(async () => (await reviews(pr))[0]?.state).toBe('approved')
    expect((await reviews(pr))[0]).toMatchObject({ source: 'github-check' })
    await poll(() => checkFor(pr.sha)?.conclusion).toBe('success')
    expect(checkFor(pr.sha)?.actions.map((a) => a.identifier)).toEqual(['reject'])
  })

  it('the Reject button rejects: failure on the check', async () => {
    const pr = await pending()
    await press(pr, 'reject')
    await poll(async () => (await reviews(pr))[0]?.state).toBe('rejected')
    expect((await reviews(pr))[0]).toMatchObject({ source: 'github-check' })
    await poll(() => checkFor(pr.sha)?.conclusion).toBe('failure')
  })

  it('an unlinked GitHub user is refused with the sign-in hint and nothing changes', async () => {
    const pr = await pending()
    const before = gh.comments.filter((c) => c.prNumber === pr.number).length
    await press(pr, 'approve', STRANGER)
    await poll(() => gh.comments.filter((c) => c.prNumber === pr.number).length).toBe(before + 1)
    const reply = gh.comments.findLast((c) => c.prNumber === pr.number)
    expect(reply?.body).toContain("I couldn't tell who you are in CirCI")
    expect(reply?.body).toContain(ctx.stack.url)
    expect(await reviews(pr)).toHaveLength(0)
    expect(checkFor(pr.sha)?.conclusion).toBe('action_required')
  })

  it('a linked user outside the workspace is refused the same way', async () => {
    const pr = await pending()
    const before = gh.comments.filter((c) => c.prNumber === pr.number).length
    await press(pr, 'approve', OUTSIDER)
    await poll(() => gh.comments.filter((c) => c.prNumber === pr.number).length).toBe(before + 1)
    expect(await reviews(pr)).toHaveLength(0)
  })

  it('/circi approve from a linked member approves (github-comment) and gets a thumbs up; replay is a no-op', async () => {
    const pr = await pending()
    const { c, send } = comment(pr, 'looks fine\n/circi approve')
    const deliveryBefore = gh.find('reactions').length
    expect((await send()).status).toBe(200)
    await poll(async () => (await reviews(pr))[0]?.state).toBe('approved')
    expect((await reviews(pr))[0]).toMatchObject({ source: 'github-comment' })
    await poll(() => c.reactions).toEqual(['+1'])
    await poll(() => checkFor(pr.sha)?.conclusion).toBe('success')
    // Redelivering the very same webhook (same delivery id) changes nothing.
    const id = 'replay-approve'
    const payload = commentPayload(
      REPO,
      pr.number,
      c.id,
      '/circi approve',
      LINKED,
      p.installationId,
    )
    await gh.sendWebhook(ctx.stack.url, 'issue_comment', payload, { deliveryId: id })
    const again = await gh.sendWebhook(ctx.stack.url, 'issue_comment', payload, { deliveryId: id })
    expect(JSON.parse(again.body).duplicate).toBe(true)
    expect(gh.find('reactions').length).toBeLessThanOrEqual(deliveryBefore + 2)
    expect((await reviews(pr)).filter((r) => r.state === 'approved')).toHaveLength(1)
  })

  it('/circi reject records github-comment; an unlinked commenter is refused', async () => {
    const pr = await pending()
    const stranger = comment(pr, '/circi approve', STRANGER)
    const before = gh.comments.filter((c) => c.prNumber === pr.number).length
    await stranger.send()
    await poll(() => gh.comments.filter((c) => c.prNumber === pr.number).length).toBe(before + 1)
    expect(await reviews(pr)).toHaveLength(0)

    await comment(pr, '/circi reject').send()
    await poll(async () => (await reviews(pr))[0]?.state).toBe('rejected')
    expect((await reviews(pr))[0]).toMatchObject({ source: 'github-comment' })
  })

  it('non-commands, bot comments and commands on non-PR issues are ignored', async () => {
    const pr = await pending()
    const before = gh.requests.length
    await comment(pr, 'please /circi approve this').send()
    const bot = gh.seedComment(REPO, pr.number, '/circi approve')
    await gh.sendWebhook(ctx.stack.url, 'issue_comment', {
      ...commentPayload(REPO, pr.number, bot.id, '/circi approve', LINKED, p.installationId),
      comment: { id: bot.id, body: '/circi approve', user: { ...LINKED, type: 'Bot' } },
    })
    await gh.sendWebhook(ctx.stack.url, 'issue_comment', {
      ...commentPayload(REPO, pr.number, bot.id, '/circi approve', LINKED, p.installationId),
      issue: { number: pr.number },
    })
    expect(gh.requests.length).toBe(before)
    expect(await reviews(pr)).toHaveLength(0)
  })

  it('a GitHub 5xx is retried by the job queue without a second check run', async () => {
    const { stack } = ctx
    n += 1
    // The create fails twice (502), then works: retries use backoff of 2 s, 4 s.
    gh.failNext('POST /repos/acme/approve/check-runs', 502, 2)
    const pr = await uploadPr(stack, p, n, { login: { dot: { x: 300 + n, y: 50 } } })
    await poll(() => checkFor(pr.sha)?.conclusion, { timeout: 60_000 }).toBe('action_required')
    expect(gh.checkRuns.filter((c) => c.headSha === pr.sha)).toHaveLength(1)
    const attempts = gh
      .find('POST /repos/acme/approve/check-runs')
      .filter((r) => (r.body as { head_sha: string }).head_sha === pr.sha)
    expect(attempts.length).toBeGreaterThanOrEqual(3)
    await poll(() => gh.comments.filter((c) => c.prNumber === n).length).toBe(1)
    const logs = await stack.logs('circi')
    expect(logs).toContain('could not notify the git host, will retry')
  })

  it('a slow GitHub (timeout) is retried too', async () => {
    const { stack } = ctx
    n += 1
    // The github profile's stack gives GitHub 4 s per request (GITHUB_API_TIMEOUT_SECONDS; 15 s in
    // production): the first create outlasts it, times out and is retried after the 2 s backoff.
    gh.delayNext('POST /repos/acme/approve/check-runs', 6_000, 1)
    const pr = await uploadPr(stack, p, n, { login: { dot: { x: 300 + n, y: 90 } } })
    await poll(() => checkFor(pr.sha)?.conclusion, { timeout: 30_000 }).toBe('action_required')
    expect(gh.checkRuns.filter((c) => c.headSha === pr.sha).length).toBeGreaterThanOrEqual(1)
    await poll(() => gh.comments.filter((c) => c.prNumber === n).length).toBe(1)
  })

  it('rate limiting (403 with retry headers) is retried and then succeeds', async () => {
    const { stack } = ctx
    n += 1
    gh.failNextWith(
      'POST /repos/acme/approve/check-runs',
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '1' },
        message: 'API rate limit exceeded',
      },
      1,
    )
    const pr = await uploadPr(stack, p, n, { login: { dot: { x: 300 + n, y: 130 } } })
    await poll(() => checkFor(pr.sha)?.conclusion, { timeout: 60_000 }).toBe('action_required')
    expect(gh.checkRuns.filter((c) => c.headSha === pr.sha)).toHaveLength(1)
  })

  it('a revoked installation (401) neither crashes the worker nor the build, is not retried, and is flagged on the project', async () => {
    const { stack, setup } = ctx
    n += 1
    gh.revokeInstallation(p.installationId)
    const pr = await uploadPr(stack, p, n, { login: { dot: { x: 300 + n, y: 170 } } })
    // The build itself is fine; the dashboard still works.
    expect((await buildDetail(setup.session, p, pr.buildNumber)).build.status).toBe('complete')
    const attention = async () =>
      (
        await setup.session.get<{ gitAttention: { reason: string } | null }>(
          `/api/projects/${workspace}/${p.slug}`,
        )
      ).gitAttention?.reason
    await poll(attention, { timeout: 30_000 }).toBe('installation_revoked')
    // The job is finished, not left failing for retries.
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
    expect(checkFor(pr.sha)).toBeUndefined()
    expect((await fetch(`${stack.url}/healthz`)).status).toBe(200)
    // Once the installation works again the next build reports, and the warning goes away.
    gh.restoreInstallation(p.installationId)
    n += 1
    const next = await uploadPr(stack, p, n, { login: { dot: { x: 300 + n, y: 171 } } })
    await poll(() => checkFor(next.sha)?.conclusion, { timeout: 90_000 }).toBe('action_required')
    await poll(attention).toBeUndefined()
  })

  it('tokens and keys never reach the logs, including during failures', async () => {
    const logs = await ctx.stack.logs('circi')
    expect(logs).not.toContain('PRIVATE KEY')
    expect(logs).not.toContain(gh.webhookSecret)
    for (const t of gh.issuedTokens()) expect(logs).not.toContain(t)
  })
})
