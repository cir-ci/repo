import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startWebhookReceiver, type WebhookReceiver } from '#fakes/webhook-receiver.ts'
import { createProject, type CreatedProject } from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import { uploadOrThrow } from '#src/upload.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * The webhook address guard on the real stack, with `WEBHOOK_ALLOW_PRIVATE_ADDRESSES=false` (the
 * production default; the harness normally turns it on): private, loopback, link-local and
 * metadata addresses are refused when a webhook is added and again when one is delivered.
 */
describe('webhook address guard (private addresses refused)', () => {
  const ctx = useStack({
    dedicated: true,
    setup: true,
    env: { WEBHOOK_ALLOW_PRIVATE_ADDRESSES: 'false' },
  })
  const browser = useBrowser()
  let receiver: WebhookReceiver
  let repo: Repo
  let project: CreatedProject

  beforeAll(async () => {
    receiver = await startWebhookReceiver()
    repo = await Repo.create()
  })
  afterAll(async () => {
    await receiver.close()
    await repo.destroy()
  })

  const base = () => `/api/projects/${ctx.setup.organization.slug}/${project.slug}/webhooks`
  const add = (url: string) =>
    ctx.setup.session.request<{ error?: string }>('POST', base(), {
      url,
      events: ['build.completed'],
    })
  const count = async () =>
    Number(
      (
        await ctx.stack.sql(
          `select count(*) from webhooks where project_id in (select id from projects where slug = '${project.slug}')`,
        )
      )[0]?.[0],
    )

  it('refuses private, loopback, link-local and metadata addresses when a webhook is added', async () => {
    project = await createProject(ctx.setup.session, ctx.setup.organization.slug, 'Guarded')
    const refused = [
      'http://127.0.0.1:8080/hook',
      'http://127.1/hook',
      'http://2130706433/hook', // 127.0.0.1 as one number
      'http://0x7f.0.0.1/hook',
      'http://localhost/hook',
      'http://localhost:3000/hook',
      'http://foo.localhost/hook',
      'http://10.0.0.5/hook',
      'http://172.16.0.1/hook',
      'http://192.168.1.1/hook',
      'http://100.64.0.1/hook', // carrier-grade NAT
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://0.0.0.0/hook',
      'http://[::1]/hook',
      'http://[fe80::1]/hook',
      'http://[fd00::1]/hook',
      'http://[::ffff:127.0.0.1]/hook',
      'http://[::ffff:169.254.169.254]/hook',
      `${receiver.url}/hook`, // host.docker.internal
      'http://circi/hook', // a name without a dot: an internal host
      'http://postgres:5432/',
      'http://printer.lan/hook',
      'http://metadata.google.internal/hook',
    ]
    for (const url of refused) {
      // oxlint-disable-next-line no-await-in-loop -- sequential keeps the output readable
      const res = await add(url)
      expect({ url, status: res.status }).toEqual({ url, status: 400 })
      expect(`${url}: ${res.body.error}`).toMatch(/private network/)
    }
    expect(await count()).toBe(0)

    // A public address is fine (nothing is called when it is added).
    const ok = await add('https://hooks.example.com/circi')
    expect(ok.status).toBe(201)
    expect(await count()).toBe(1)
  })

  it('shows the reason in the settings page when the address is refused', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${setup.organization.slug}/${project.slug}/settings`)
    await page.getByRole('textbox', { name: 'Address' }).fill('http://169.254.169.254/latest/')
    await page.getByRole('button', { name: 'Add webhook' }).click()
    await page.getByText('That address is on a private network').waitFor()
    expect(await page.getByText(/whsec_/).count()).toBe(0)
    expect(await count()).toBe(1)
  })

  it('does not deliver to a private receiver that got into the table anyway (checked again at delivery)', async () => {
    const { stack } = ctx
    // Reachable and listening, but private: written straight to the table, as an older version
    // or a changed instance setting could have left it.
    const id = (
      await stack.sql(
        `insert into webhooks (project_id, url, secret, events)
         select id, '${receiver.url}/leak', 'whsec_test', '{build.completed}' from projects where slug = '${project.slug}'
         returning id`,
      )
    )[0]?.[0]
    expect(id).toBeTruthy()
    receiver.setSecret('whsec_test')

    await repo.writeShots({ home: {} })
    await repo.commit('first')
    await uploadOrThrow({ stack, token: project.token, repo, wait: true })

    await expect
      .poll(
        async () =>
          (
            await stack.sql(
              `select status from jobs where queue = 'webhook' and payload->>'webhookId' = '${id}'`,
            )
          )[0]?.[0],
        { timeout: 30_000 },
      )
      .toBe('done')
    // Skipped, not delivered, and not retried.
    expect(receiver.deliveries).toHaveLength(0)
    const logs = (await stack.logs('circi', { tail: 400 }))
      .split('\n')
      .filter((l) => l.includes(String(id)))
      .join('\n')
    expect(logs).toContain('webhook address is on a private network')
    expect(logs).not.toContain('webhook delivery failed')
  })

  it('does not deliver to a public-looking name that resolves to a private address', async () => {
    const { stack } = ctx
    // nip.io resolves <ip>.nip.io to that IP; skipped when the machine has no DNS.
    const name = '127.0.0.1.nip.io'
    const resolved = await stack.exec('circi', ['getent', 'hosts', name], { allowFail: true })
    if (!resolved.stdout.includes('127.0.0.1')) {
      console.log('[e2e] no DNS for nip.io here: skipping the DNS-rebinding case')
      return
    }
    const created = await add(`http://${name}:${receiver.port}/rebind`)
    // The address check on the literal text passes (it is a name), so it is added...
    expect(created.status).toBe(201)
    const hook = (
      await ctx.setup.session.get<{ webhooks: { id: string; url: string }[] }>(
        `/api/projects/${ctx.setup.organization.slug}/${project.slug}/settings`,
      )
    ).webhooks.find((h) => h.url.includes('nip.io'))
    expect(hook).toBeDefined()

    await repo.writeShots({ home: { dot: { x: 5, y: 5 } } })
    await repo.commit('second')
    await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    // ...and refused when it is delivered.
    await expect
      .poll(
        async () =>
          (
            await stack.sql(
              `select status from jobs where queue = 'webhook' and payload->>'webhookId' = '${hook?.id}'`,
            )
          )[0]?.[0],
        { timeout: 30_000 },
      )
      .toBe('done')
    expect(receiver.deliveries).toHaveLength(0)
  })
})
