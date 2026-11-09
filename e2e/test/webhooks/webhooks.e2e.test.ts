import type { Build } from '@circi/api'
import { verifyWebhookSignature } from '@circi/core/node'
import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTeam, type CreatedTeam, type Session } from '#clients/admin.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { listen } from '#fakes/http.ts'
import { startWebhookReceiver, type WebhookReceiver } from '#fakes/webhook-receiver.ts'
import { Repo } from '#github/git-repo.ts'
import type { Stack } from '#stack/stack.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

/**
 * Outgoing webhooks on the real stack (private addresses allowed, as the harness sets): added in
 * the team settings, signed deliveries to a receiver on the host, event filters, retries with
 * backoff and giving up, redirects not followed, removal. The receiver is a fake at the edge;
 * the worker, the job queue and the signing are CirCI's own.
 */

interface JobRow {
  status: string
  attempts: number
  error: string
  /** Seconds until the job is due again (negative: already due). */
  dueIn: number
}

const hookJobs = async (stack: Stack, webhookId: string): Promise<JobRow[]> =>
  (
    await stack.sql(
      `select status, attempts, coalesce(last_error, ''), extract(epoch from (run_at - now()))::int
       from jobs where queue = 'webhook' and payload->>'webhookId' = '${webhookId}' order by id`,
    )
  ).map(([status = '', attempts = '0', error = '', dueIn = '0']) => ({
    status,
    attempts: Number(attempts),
    error,
    dueIn: Number(dueIn),
  }))

interface HookView {
  id: string
  url: string
  events: string[]
  enabled: boolean
}
const hooksOf = async (session: Session, workspace: string, team: string) =>
  (await session.get<{ webhooks: HookView[] }>(`/api/teams/${workspace}/${team}/settings`)).webhooks

/** The worker's log lines about one webhook's failed deliveries (they survive the job's own rows changing). */
const failures = async (stack: Stack, webhookId: string) =>
  (await stack.logs('circi'))
    .split('\n')
    .filter((l) => l.includes(webhookId) && l.includes('webhook delivery failed'))
    .map((l) => String((JSON.parse(l.slice(l.indexOf('{'))) as { err?: string }).err))

const disable = (stack: Stack, ...ids: string[]) =>
  stack.sql(
    `update webhooks set enabled = false where id in (${ids.map((i) => `'${i}'`).join(',')})`,
  )

const gapsOf = (r: WebhookReceiver) =>
  r.deliveries
    .slice(1)
    .map((d, i) => d.receivedAt.getTime() - (r.deliveries[i]?.receivedAt.getTime() ?? 0))

/** The page's Add webhook button opens the dialog with the form. */
async function openAddDialog(page: Page) {
  await page.getByRole('button', { name: 'Add webhook' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add webhook' })
  await dialog.waitFor()
  return dialog
}

describe('webhooks (private addresses allowed)', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let completedOnly: WebhookReceiver
  let reviewedOnly: WebhookReceiver
  let repo: Repo
  let team: CreatedTeam
  let completedHookId = ''
  let reviewedHookId = ''
  let prBuildNumber = 0
  const closers: (() => Promise<void>)[] = []
  let completedSecret = ''

  beforeAll(async () => {
    completedOnly = await startWebhookReceiver()
    reviewedOnly = await startWebhookReceiver()
    repo = await Repo.create()
  })
  afterAll(async () => {
    await completedOnly.close()
    await reviewedOnly.close()
    await Promise.all(closers.map((close) => close()))
    await repo.destroy()
  })

  const settingsUrl = () =>
    `${ctx.stack.url}/${ctx.setup.workspace.slug}/${team.slug}/settings/webhooks`
  const hooks = () => hooksOf(ctx.setup.session, ctx.setup.workspace.slug, team.slug)
  const apiAdd = (url: string, events: string[]) =>
    ctx.setup.session.post<{ webhook: HookView; secret: string }>(
      `/api/teams/${ctx.setup.workspace.slug}/${team.slug}/webhooks`,
      { url, events },
    )

  async function addThroughUi(page: Page, url: string, uncheck: string[] = []): Promise<string> {
    await page.goto(settingsUrl())
    const dialog = await openAddDialog(page)
    await dialog.getByRole('textbox', { name: 'Address' }).fill(url)
    for (const event of uncheck) await dialog.getByRole('checkbox', { name: event }).click()
    await dialog.getByRole('button', { name: 'Add webhook' }).click()
    const banner = page.getByText(/whsec_[\w-]+/)
    await banner.waitFor()
    const secret = /whsec_[\w-]+/.exec((await banner.first().textContent()) ?? '')?.[0]
    if (!secret) throw new Error('no signing secret on the page')
    return secret
  }

  it('adds a webhook in the settings page: the signing secret is shown once, never again', async () => {
    const { setup } = ctx
    team = await createTeam(setup.session, setup.workspace.slug, 'Hooked')
    const page = await browser.as(setup.session)

    const secret = await addThroughUi(page, `${completedOnly.url}/hooks/completed`, [
      'build.reviewed',
    ])
    expect(secret).toMatch(/^whsec_[\w-]{20,}$/)
    completedOnly.setSecret(secret)
    completedSecret = secret
    await page.getByText('Copy it now: it isn’t shown again.').waitFor()
    await page.getByRole('button', { name: 'Done' }).click()

    const list = page.getByRole('list', { name: 'Webhooks' })
    await list.getByText(`${completedOnly.url}/hooks/completed`).waitFor()
    expect(await list.getByRole('list', { name: 'Events' }).innerText()).toBe('build.completed')

    // Reloading: the secret is gone from the page and the API never returns it.
    await page.reload()
    await page.getByRole('list', { name: 'Webhooks' }).getByText('hooks/completed').waitFor()
    expect(await page.getByText(/whsec_/).count()).toBe(0)
    const listed = await hooks()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ events: ['build.completed'], enabled: true })
    expect(JSON.stringify(listed)).not.toContain('whsec_')
    completedHookId = listed[0]?.id ?? ''

    // The second receiver listens to reviews only (added through the API).
    const created = await apiAdd(`${reviewedOnly.url}/hooks/reviewed`, ['build.reviewed'])
    reviewedOnly.setSecret(created.secret)
    reviewedHookId = created.webhook.id
    expect(created.secret).toMatch(/^whsec_/)
    expect(created.secret).not.toBe(secret)
    expect(created.webhook).not.toHaveProperty('secret')
  })

  it('delivers build.completed with the documented payload, signed with the shown secret', async () => {
    const { stack, setup } = ctx
    const workspace = setup.workspace.slug
    await repo.writeShots({ home: {}, login: { dot: { x: 40, y: 40 } } })
    const sha = await repo.commit('first')
    const up = await uploadOrThrow({ stack, token: team.token, repo, wait: true })

    const d = await completedOnly.waitFor((x) => x.event === 'build.completed')
    expect(d.path).toBe('/hooks/completed')
    expect(d.signatureValid).toBe(true)
    expect(d.headers['user-agent']).toBe('CirCI-Webhook')
    expect(d.headers['content-type']).toBe('application/json')
    const body = d.json as Record<string, unknown>
    expect(body).toMatchObject({
      id: d.deliveryId,
      event: 'build.completed',
      url: `${stack.url}/${workspace}/${team.slug}/builds/${up.build.number}`,
      workspace: { slug: workspace },
      team: { slug: team.slug, name: 'Hooked' },
      build: {
        id: up.build.id,
        number: up.build.number,
        status: 'complete',
        reviewStatus: expect.any(String),
        commitSha: sha,
        branch: 'main',
        prNumber: null,
      },
    })
    expect(d.deliveryId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isNaN(Date.parse(String(body['createdAt'])))).toBe(false)
    expect((body['team'] as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body).not.toHaveProperty('review')
    // A forged or tampered request would not verify.
    const header = String(d.headers['circi-signature'])
    expect(verifyWebhookSignature('whsec_wrong', d.rawBody, header)).toBe(false)
    expect(verifyWebhookSignature(completedSecret, d.rawBody, header)).toBe(true)
    expect(verifyWebhookSignature(completedSecret, `${d.rawBody} `, header)).toBe(false)

    // The reviews-only webhook was not called for it, and never even queued.
    expect(reviewedOnly.deliveries).toHaveLength(0)
    expect(await hookJobs(stack, reviewedHookId)).toEqual([])
    // One job, done in one attempt.
    expect(await hookJobs(stack, completedHookId)).toMatchObject([{ status: 'done', attempts: 1 }])
  })

  it('a pull request build and its review: each webhook gets only its events', async () => {
    const { stack, setup } = ctx
    const workspace = setup.workspace.slug
    await repo.checkout('feature', { create: true })
    await repo.writeShots({ login: { dot: { x: 300, y: 200 } } })
    await repo.commit('move the button')
    const up = await uploadOrThrow({
      stack,
      token: team.token,
      repo,
      wait: true,
      pr: { number: 12 },
    })
    prBuildNumber = up.build.number
    const done = await completedOnly.waitFor(
      (x) => (x.json as { build?: { number?: number } }).build?.number === prBuildNumber,
    )
    expect(done.json).toMatchObject({
      event: 'build.completed',
      build: {
        conclusion: 'changes_detected',
        reviewStatus: 'pending',
        prNumber: 12,
        branch: 'feature',
      },
    })
    expect(reviewedOnly.deliveries).toHaveLength(0)

    // Approve in the browser.
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace}/${team.slug}/builds/${prBuildNumber}`)
    await page.getByRole('button', { name: 'Approve all' }).click()

    const reviewed = await reviewedOnly.waitFor((x) => x.event === 'build.reviewed')
    expect(reviewed.signatureValid).toBe(true)
    expect(reviewed.path).toBe('/hooks/reviewed')
    expect(reviewed.json).toMatchObject({
      event: 'build.reviewed',
      build: { number: prBuildNumber, reviewStatus: 'approved', prNumber: 12 },
      review: { state: 'approved', source: 'ui', reviewer: setup.account.name },
    })

    // Deciding the same thing again changes nothing, so nothing is sent. Changing the decision is.
    await setup.session.post(
      `/api/teams/${workspace}/${team.slug}/builds/${prBuildNumber}/review`,
      {
        state: 'approved',
      },
    )
    await setup.session.post(
      `/api/teams/${workspace}/${team.slug}/builds/${prBuildNumber}/review`,
      {
        state: 'rejected',
      },
    )
    const rejected = await reviewedOnly.waitFor(
      (x) => (x.json as { review?: { state?: string } }).review?.state === 'rejected',
    )
    expect(rejected.signatureValid).toBe(true)
    expect(reviewedOnly.deliveries.map((x) => x.event)).toEqual([
      'build.reviewed',
      'build.reviewed',
    ])

    // The completed-only webhook saw both completions, no review.
    expect(completedOnly.deliveries.map((x) => x.event)).toEqual([
      'build.completed',
      'build.completed',
    ])
    expect(
      (
        await stack.sql(
          `select count(*) from jobs where queue = 'webhook'
           and payload->>'webhookId' = '${completedHookId}' and payload->>'event' = 'build.reviewed'`,
        )
      )[0]?.[0],
    ).toBe('0')
    const detail = await setup.session.get<Build.Detail>(
      `/api/teams/${workspace}/${team.slug}/builds/${prBuildNumber}`,
    )
    expect(detail.build.reviewStatus).toBe('rejected')
  })

  it('a webhook needs at least one event: empty or missing is refused, in the API and in the form', async () => {
    const { setup } = ctx
    const workspace = setup.workspace.slug
    const url = `/api/teams/${workspace}/${team.slug}/webhooks`
    for (const body of [
      { url: 'https://example.com/none' },
      { url: 'https://example.com/none', events: [] },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- two requests
      const res = await setup.session.request<{ error: string }>('POST', url, body)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Choose at least one event')
    }
    // The form: unticking every event shows the error beside them and sends nothing.
    const page = await browser.as(setup.session)
    await page.goto(settingsUrl())
    const dialog = await openAddDialog(page)
    await dialog.getByRole('textbox', { name: 'Address' }).fill('https://example.com/none')
    await dialog.getByRole('checkbox', { name: 'build.completed' }).click()
    await dialog.getByRole('checkbox', { name: 'build.reviewed' }).click()
    await dialog.getByRole('button', { name: 'Add webhook' }).click()
    await dialog.getByRole('alert').filter({ hasText: 'Choose at least one event' }).waitFor()
    expect(await hooks()).toHaveLength(2)

    const refused = async (body: unknown) => (await setup.session.request('POST', url, body)).status
    const events = ['build.completed']
    expect(await refused({ url: 'https://example.com/x', events: ['build.exploded'] })).toBe(400)
    expect(await refused({ url: 'ftp://example.com/x', events })).toBe(400)
    expect(await refused({ url: 'not a url', events })).toBe(400)
    expect(await refused({ url: 'https://user:pw@example.com/x', events })).toBe(400)
    expect(await refused({ url: `https://example.com/${'a'.repeat(2100)}`, events })).toBe(400)
    expect(await hooks()).toHaveLength(2)
  })

  it('a failing receiver is retried with exponential backoff and the same delivery id, until it recovers', async () => {
    const { stack } = ctx
    const flaky = await startWebhookReceiver()
    closers.push(() => flaky.close())
    const created = await apiAdd(`${flaky.url}/retry`, ['build.completed'])
    flaky.setSecret(created.secret)
    flaky.failWith(500, 2)

    await repo.checkout('main')
    await repo.writeShots({ home: { dot: { x: 9, y: 9 } } })
    await repo.commit('main again')
    await uploadOrThrow({ stack, token: team.token, repo, wait: true })

    // Two failures, then the third attempt is accepted: one delivery id, the same signed body.
    await expect.poll(() => flaky.deliveries.length, { timeout: 60_000 }).toBe(3)
    expect(flaky.deliveries.map((d) => d.respondedWith)).toEqual([500, 500, 200])
    expect(new Set(flaky.deliveries.map((d) => d.deliveryId)).size).toBe(1)
    expect(flaky.deliveries.every((d) => d.signatureValid)).toBe(true)
    expect(new Set(flaky.deliveries.map((d) => d.rawBody)).size).toBe(1)
    // Backoff 2 s, then 4 s.
    const [g1 = 0, g2 = 0] = gapsOf(flaky)
    expect(g1).toBeGreaterThanOrEqual(1_500)
    expect(g2).toBeGreaterThanOrEqual(3_500)
    expect(g2).toBeGreaterThan(g1)
    await expect
      .poll(async () => (await hookJobs(stack, created.webhook.id))[0])
      .toMatchObject({ status: 'done', attempts: 3, error: '' })
    expect(await failures(stack, created.webhook.id)).toHaveLength(2)
    await disable(stack, created.webhook.id)
  })

  // Long timeout: the first attempts run on their real backoff (2 s, 4 s, 8 s).
  it(
    'gives up after 8 attempts (backoff doubling) and keeps the last error',
    { timeout: 90_000 },
    async () => {
      const { stack } = ctx
      const down = await startWebhookReceiver()
      closers.push(() => down.close())
      const created = await apiAdd(`${down.url}/down`, ['build.completed'])
      down.setSecret(created.secret)
      down.failWith(503)
      const id = created.webhook.id

      await repo.writeShots({ home: { dot: { x: 20, y: 20 } } })
      await repo.commit('another main')
      await uploadOrThrow({ stack, token: team.token, repo, wait: true })

      // The first attempts run on their real schedule (2 s, 4 s, 8 s) ...
      await expect.poll(() => down.deliveries.length, { timeout: 90_000 }).toBeGreaterThanOrEqual(4)
      const [g1 = 0, g2 = 0, g3 = 0] = gapsOf(down)
      expect(g1).toBeGreaterThanOrEqual(1_500)
      expect(g2).toBeGreaterThanOrEqual(3_500)
      expect(g3).toBeGreaterThanOrEqual(7_500)
      // ... then the clock is wound forward past the longer waits.
      await expect
        .poll(
          async () => {
            await stack.jobs.runNow('webhook', { webhookId: id })
            return (await hookJobs(stack, id))[0]?.status
          },
          { timeout: 120_000, interval: 500 },
        )
        .toBe('failed')
      const [final] = await hookJobs(stack, id)
      expect(final).toMatchObject({ status: 'failed', attempts: 8 })
      expect(final?.error).toContain('answered 503')
      expect(down.deliveries).toHaveLength(8)
      expect(new Set(down.deliveries.map((d) => d.deliveryId)).size).toBe(1)
      expect(await stack.logs('circi')).toContain('webhook delivery failed for good')

      // Given up means given up: a recovered receiver is not called for the abandoned delivery.
      // Barrier instead of a sleep: the receiver recovers and a later event is sent to it. Once
      // that one has arrived, the worker has certainly had its chance to retry the old delivery.
      down.succeed()
      const abandoned = down.deliveries[0]?.deliveryId
      await repo.writeShots({ home: { dot: { x: 21, y: 21 } } })
      await repo.commit('after giving up')
      await uploadOrThrow({ stack, token: team.token, repo, wait: true })
      await expect.poll(() => down.deliveries.length, { timeout: 30_000 }).toBeGreaterThan(8)
      expect(down.deliveries.filter((d) => d.deliveryId === abandoned)).toHaveLength(8)
      expect(down.deliveries.at(-1)?.respondedWith).toBe(200)
      await disable(stack, id)
    },
  )

  it('a refused connection and a receiver that never answers are retried too', async () => {
    const { stack } = ctx
    // Connection refused: a port that was listening a moment ago.
    const gone = await listen((_req, res) => res.end())
    const gonePort = gone.port
    await gone.close()
    const refused = await apiAdd(`http://host.docker.internal:${gonePort}/gone`, [
      'build.completed',
    ])
    // Never answers: the connection stays open until CirCI's 10 s timeout.
    let hits = 0
    const silent = await listen(() => {
      hits += 1
    })
    closers.push(() => silent.close())
    const slow = await apiAdd(`http://host.docker.internal:${silent.port}/slow`, [
      'build.completed',
    ])

    await repo.writeShots({ home: { dot: { x: 30, y: 30 } } })
    await repo.commit('main for failures')
    await uploadOrThrow({ stack, token: team.token, repo, wait: true })

    await expect
      .poll(async () => (await failures(stack, refused.webhook.id))[0], { timeout: 60_000 })
      .toMatch(/fetch failed|ECONNREFUSED/)
    await expect
      .poll(async () => (await failures(stack, slow.webhook.id))[0], { timeout: 90_000 })
      .toMatch(/timeout|aborted/i)
    expect(hits).toBeGreaterThanOrEqual(1)
    expect((await hookJobs(stack, refused.webhook.id))[0]).toMatchObject({
      attempts: expect.any(Number),
    })
    // Both are still waiting for another attempt, not abandoned after one.
    expect((await hookJobs(stack, refused.webhook.id))[0]?.status).toBe('pending')
    await disable(stack, refused.webhook.id, slow.webhook.id)
  })

  it('does not follow a redirect: the signed body never goes anywhere the owner did not configure', async () => {
    const { stack } = ctx
    let leaked = 0
    const target = await listen((_req, res) => {
      leaked += 1
      res.end('ok')
    })
    closers.push(() => target.close())
    const redirecting = await listen((_req, res) => {
      res.statusCode = 302
      res.setHeader('location', `http://host.docker.internal:${target.port}/leak`)
      res.end()
    })
    closers.push(() => redirecting.close())
    const created = await apiAdd(`http://host.docker.internal:${redirecting.port}/r`, [
      'build.completed',
    ])

    await repo.writeShots({ home: { dot: { x: 50, y: 50 } } })
    await repo.commit('main for redirect')
    await uploadOrThrow({ stack, token: team.token, repo, wait: true })

    await expect
      .poll(async () => (await hookJobs(stack, created.webhook.id))[0], { timeout: 30_000 })
      .toMatchObject({
        // Any attempt count: the job is retried, and by the time the poll sees it the worker may
        // be on its second or third try. What matters is that it keeps failing on the redirect.
        status: 'pending',
        attempts: expect.any(Number),
        error: expect.stringContaining('answered 302'),
      })
    expect(leaked).toBe(0)
    await stack.sql(`update webhooks set enabled = false where id = '${created.webhook.id}'`)
  })

  it('removing a webhook asks first; afterwards nothing more is delivered to it', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(settingsUrl())
    const row = page
      .getByRole('listitem')
      .filter({ hasText: `${completedOnly.url}/hooks/completed` })
    await row.getByRole('button', { name: 'Remove' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByText('Remove webhook?').waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect((await hooks()).some((h) => h.id === completedHookId)).toBe(true)

    await row.getByRole('button', { name: 'Remove' }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await row.waitFor({ state: 'detached' })
    expect((await hooks()).some((h) => h.id === completedHookId)).toBe(false)

    // Settle first: every job queued for it so far has been delivered.
    await expect
      .poll(async () => (await hookJobs(stack, completedHookId)).every((j) => j.status === 'done'))
      .toBe(true)
    const jobsBefore = (await hookJobs(stack, completedHookId)).length
    const before = completedOnly.deliveries.length
    expect(before).toBe(jobsBefore)
    await repo.writeShots({ home: { dot: { x: 70, y: 70 } } })
    await repo.commit('main after removal')
    const up = await uploadOrThrow({ stack, token: team.token, repo, wait: true })
    expect(up.status?.build.status).toBe('complete')
    // Nothing was queued for it and nothing arrived.
    expect((await hookJobs(stack, completedHookId)).length).toBe(jobsBefore)
    expect(completedOnly.deliveries).toHaveLength(before)
    // Removing it again, or one that never existed, is a 404.
    const again = await setup.session.request(
      'DELETE',
      `/api/teams/${setup.workspace.slug}/${team.slug}/webhooks/${completedHookId}`,
    )
    expect(again.status).toBe(404)
  })
})
