import { describe, expect, it } from 'vitest'

import {
  createTeam,
  createUserViaCli,
  extractCode,
  extractLinks,
  freshIp,
  fullWorkspace,
  mailIds,
  newAccount,
  requestCode,
  requestCodeRaw,
  signIn,
  signInWithCode,
  signInWithCodeThroughUi,
  tryCode,
  waitForNewMail,
  withBrowser,
} from '#src/index.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * Emailed sign-in codes, workspace email domains and per-workspace sign-in methods on the
 * real stack (mail is Mailpit; nothing is faked except the DNS proof of a domain, see below).
 */
describe('email-code sign-in', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  const workspace = () => ctx.setup.workspace.slug
  const SIGN_IN_MAIL = 'sign-in code'

  /** A member of Acme with a password (created by the operator) who also signs in by code. */
  async function member(label: string) {
    const account = await createUserViaCli(ctx.stack, { account: newAccount(label) })
    await ctx.stack.cli(
      'member',
      'add',
      '--org',
      workspace(),
      '--email',
      account.email,
      '--role',
      'member',
    )
    return account
  }

  /** Asks for a code through the API and returns it, read from Mailpit. */
  async function codeFor(email: string): Promise<string> {
    const seen = await mailIds(ctx.stack.mail, email)
    // Every call comes from its own client address (see `freshIp`), so only the per-address
    // limit (5 codes per 15 minutes) can answer 429 here, and no test asks that often.
    expect(await requestCode(ctx.stack.url, email)).toBe(200)
    return extractCode(await waitForNewMail(ctx.stack.mail, email, seen, { subject: SIGN_IN_MAIL }))
  }

  it('mails a 6-digit code once, with a link that fills it in; a code works only once', async () => {
    const { stack } = ctx
    const alice = await member('alice')
    const seen = await mailIds(stack.mail, alice.email)
    await withBrowser(browser.browser, {}, async (page) => {
      await page.goto(`${stack.url}/login`)
      await page.getByRole('button', { name: 'Email me a sign-in code instead' }).click()
      await page.getByLabel('Email').fill(alice.email)
      await page.getByRole('button', { name: 'Email me a code' }).click()
      await page.getByText(`If ${alice.email} has an account, we sent it a 6-digit code.`).waitFor()
    })
    const mail = await waitForNewMail(stack.mail, alice.email, seen, { subject: SIGN_IN_MAIL })
    const code = extractCode(mail)
    expect(code).toMatch(/^\d{6}$/)
    expect(mail.Subject).toBe(`Your CirCI sign-in code: ${code}`)
    expect(mail.To.map((t) => t.Address)).toEqual([alice.email])
    expect(mail.Text).toContain('expires in 10 minutes')
    expect(mail.Text).not.toContain(alice.password)
    // The code and address travel in the URL fragment, so no server or proxy ever sees them.
    const [link] = extractLinks(mail)
    expect(link).toBe(`${stack.url}/#signin-email=${encodeURIComponent(alice.email)}&code=${code}`)

    // Opening the link fills the code in but signs no one in until the click.
    await withBrowser(browser.browser, {}, async (page) => {
      await page.goto(link ?? '')
      await page.getByLabel('6-digit code').waitFor()
      expect(await page.getByLabel('6-digit code').inputValue()).toBe(code)
      expect(await page.getByRole('button', { name: /^Account menu for / }).count()).toBe(0)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByRole('button', { name: `Account menu for ${alice.name}` }).waitFor()
      // The link's secret is gone from the address bar after signing in.
      expect(new URL(page.url()).hash).toBe('')
    })

    // Used once: the same code is refused, with the page's message.
    const again = await tryCode(stack.url, alice.email, code)
    expect(again.status).toBeGreaterThanOrEqual(400)
    expect(again.setCookies.some((c) => c.includes('session_token'))).toBe(false)
  })

  it('shows "wrong or expired" in the page for a wrong code', async () => {
    const { stack } = ctx
    const alice = await member('wrongui')
    await withBrowser(browser.browser, {}, async (page) => {
      await page.goto(`${stack.url}/login`)
      await page.getByRole('button', { name: 'Email me a sign-in code instead' }).click()
      await page.getByLabel('Email').fill(alice.email)
      await page.getByRole('button', { name: 'Email me a code' }).click()
      await page.getByLabel('6-digit code').fill('000000')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByText('That code is wrong or has expired.').waitFor()
      expect(await page.getByText('That code is wrong or has expired.').count()).toBe(1)
    })
  })

  it('locks a code after 5 wrong attempts, even for the right code', async () => {
    const { stack } = ctx
    const alice = await member('lock')
    const code = await codeFor(alice.email)
    const wrong = code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 5; i++) {
      const res = await tryCode(stack.url, alice.email, wrong)
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
    const right = await tryCode(stack.url, alice.email, code)
    expect(right.status).toBeGreaterThanOrEqual(400)
    expect(right.setCookies.some((c) => c.includes('session_token'))).toBe(false)
    // A fresh code works again.
    const fresh = await codeFor(alice.email)
    expect((await tryCode(stack.url, alice.email, fresh)).status).toBe(200)
  })

  it('a code stops working after 10 minutes', async () => {
    const { stack } = ctx
    const alice = await member('late')
    const code = await codeFor(alice.email)
    const rows = await stack.sql(
      `update verification set expires_at = now() - interval '1 minute' where identifier like '%${alice.email}%' returning id`,
    )
    expect(rows.length).toBeGreaterThan(0)
    const res = await tryCode(stack.url, alice.email, code)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.setCookies.some((c) => c.includes('session_token'))).toBe(false)
    // And one asked for now is fine.
    expect((await tryCode(stack.url, alice.email, await codeFor(alice.email))).status).toBe(200)
  })

  it('the per-client limit: 3 requests a minute per endpoint and client address', async () => {
    const { stack } = ctx
    const alice = await member('limited')
    // The one test that sends several requests from the same client address, to see the limiter
    // itself; everywhere else each request has its own address (see `freshIp`).
    const address = freshIp()
    const statuses: number[] = []
    let retryAfter: number | undefined
    for (let i = 0; i < 4; i++) {
      const res = await requestCodeRaw(stack.url, alice.email, { address })
      statuses.push(res.status)
      retryAfter = res.retryAfter
    }
    expect(statuses).toEqual([200, 200, 200, 429])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
    // It counts per endpoint: the same client can still try a code, and another client can ask.
    expect((await tryCode(stack.url, alice.email, '000000', { address })).status).not.toBe(429)
    expect((await requestCodeRaw(stack.url, alice.email)).status).toBe(200)
  })

  it('answers an unknown address like a known one, sends it no mail, and limits both to 5 per 15 minutes', async () => {
    const { stack } = ctx
    const known = await member('known')
    const stranger = newAccount('stranger')

    // Each request has its own client address, so better-auth's per-client limit (3 a minute)
    // stays out of it: what is counted here is the per-address limit alone.
    const ask = (email: string) => requestCodeRaw(stack.url, email)
    const outcome = async (email: string) => {
      const statuses: number[] = []
      let firstBody: unknown
      for (let i = 0; i < 6; i++) {
        const res = await ask(email)
        statuses.push(res.status)
        if (i === 0) firstBody = res.body
      }
      return { statuses, firstBody }
    }
    const seenStranger = await mailIds(stack.mail, stranger.email)
    const a = await outcome(stranger.email)
    const b = await outcome(known.email)
    expect(a.statuses).toEqual([200, 200, 200, 200, 200, 429])
    expect(b.statuses).toEqual(a.statuses)
    expect(a.firstBody).toEqual(b.firstBody)

    // The known address got its codes; the stranger got nothing at all.
    await waitForNewMail(stack.mail, known.email, new Set(), { subject: SIGN_IN_MAIL })
    await expect
      .poll(async () => (await stack.mail.to(known.email)).length)
      .toBeGreaterThanOrEqual(5)
    expect(await mailIds(stack.mail, stranger.email)).toEqual(seenStranger)

    // In the page: the stranger sees the same "we sent a code" step as everyone.
    await withBrowser(browser.browser, {}, async (page) => {
      await page.goto(`${stack.url}/login`)
      await page.getByRole('button', { name: 'Email me a sign-in code instead' }).click()
      await page.getByLabel('Email').fill(newAccount('ui-stranger').email)
      await page.getByRole('button', { name: 'Email me a code' }).click()
      await page.getByText(/has an account, we sent it a 6-digit code/).waitFor()
    })
    // A code for an address with no account and no invitation is not accepted either.
    const res = await tryCode(stack.url, stranger.email, '123456')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(
      (await stack.sql(`select count(*) from "user" where email = '${stranger.email}'`))[0]?.[0],
    ).toBe('0')
  })

  it('warns by mail about a sign-in from an unfamiliar browser, once', async () => {
    const { stack } = ctx
    const dana = await member('dana')
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130 CirCI-E2E-Laptop'
    const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) CirCI-E2E-Phone'
    const warnings = async () =>
      (await stack.mail.to(dana.email)).filter(
        (m) => m.Subject === 'New sign-in to your CirCI account',
      )

    await withBrowser(browser.browser, { userAgent: chrome }, (page) =>
      signInWithCodeThroughUi(page, stack.url, stack.mail, dana.email),
    )
    // The very first sign-in has nothing to compare with: no warning.
    expect(await warnings()).toHaveLength(0)

    const seen = await mailIds(stack.mail, dana.email)
    await withBrowser(browser.browser, { userAgent: phone }, (page) =>
      signInWithCodeThroughUi(page, stack.url, stack.mail, dana.email),
    )
    const mail = await waitForNewMail(stack.mail, dana.email, seen, {
      subject: 'New sign-in to your CirCI account',
    })
    expect(mail.Text).toContain('email code')
    expect(mail.Text).toContain('CirCI-E2E-Phone')
    expect(mail.Text).not.toContain(dana.password)
    expect(mail.Text).not.toMatch(/\b\d{6}\b/)

    // The same phone again is familiar now.
    await withBrowser(browser.browser, { userAgent: phone }, (page) =>
      signInWithCodeThroughUi(page, stack.url, stack.mail, dana.email),
    )
    expect(await warnings()).toHaveLength(1)
  })

  it('Acme can turn the password off: password sessions stop seeing its teams, code sessions keep them', async () => {
    const { stack, setup } = ctx
    const team = await createTeam(setup.session, workspace(), 'Methods')
    const sam = await member('sam')
    const viaPassword = await signIn(stack, sam.email, sam.password)
    const viaCode = await signInWithCode(stack.url, stack.mail, sam.email)
    const slugs = async (s: typeof viaCode) =>
      (await s.get<{ teams: { team: { slug: string } }[] }>('/api/teams')).teams.map(
        (p) => p.team.slug,
      )
    expect(await slugs(viaPassword)).toContain(team.slug)

    // The owner unticks "Password" on the Members page.
    const adminByCode = await signInWithCode(stack.url, stack.mail, setup.account.email)
    const page = await browser.as(adminByCode)
    await page.goto(`${stack.url}/workspaces/${workspace()}/members`)
    const box = page.getByRole('checkbox', { name: 'Password' })
    await box.waitFor()
    await box.click()
    await expect
      .poll(
        async () =>
          (
            await adminByCode.get<{ settings: { passwordLoginEnabled: boolean } }>(
              `/api/workspaces/${workspace()}/auth`,
            )
          ).settings.passwordLoginEnabled,
      )
      .toBe(false)

    // Sam's password session no longer sees the workspace; the emailed-code one does.
    expect(await slugs(viaPassword)).not.toContain(team.slug)
    expect(
      (await viaPassword.request('GET', `/api/teams/${workspace()}/${team.slug}`)).status,
    ).toBe(404)
    const caps = await viaPassword.get<{
      refusingWorkspaces: { name: string; accepts: string[] }[]
    }>('/api/capabilities')
    expect(caps.refusingWorkspaces).toEqual([{ name: setup.workspace.name, accepts: ['email'] }])
    expect(await slugs(viaCode)).toContain(team.slug)
    // better-auth's own endpoints obey the rule too.
    expect(
      (
        await viaPassword.request(
          'GET',
          `/api/auth/organization/get-full-organization?organizationSlug=${workspace()}`,
        )
      ).status,
    ).toBe(404)

    // Turning both off would lock everyone out: refused.
    const both = await adminByCode.request('PATCH', `/api/workspaces/${workspace()}/auth`, {
      emailLoginEnabled: false,
    })
    expect(both.status).toBeGreaterThanOrEqual(400)
    // Back on.
    await adminByCode.patch(`/api/workspaces/${workspace()}/auth`, { passwordLoginEnabled: true })
    expect(await slugs(viaPassword)).toContain(team.slug)
  })
})

describe('workspace email domains', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  const workspace = () => ctx.setup.workspace.slug
  // Its own domain: a verified domain belongs to one workspace of the whole instance.
  const domain = `corp-${Math.random().toString(36).slice(2, 8)}.e2e.test`
  const domainRows = async () =>
    (
      await ctx.stack.sql(`select count(*) from workspace_domains where domain = '${domain}'`)
    )[0]?.[0]

  it('validates, adds, cannot prove a domain without DNS, joins people once verified, and stops when removed', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/workspaces/${workspace()}/members`)
    await page.getByRole('heading', { name: 'Email domains' }).waitFor()
    const field = page.getByLabel('Domain', { exact: true })

    await page.getByRole('button', { name: 'Add domain' }).click()
    await page.getByText('Enter a domain, like example.com').waitFor()
    await field.fill(`someone@${domain}`)
    await page.getByRole('button', { name: 'Add domain' }).click()
    await page.getByText('Enter just the domain, like example.com').waitFor()
    await field.fill(domain)
    await page.getByRole('button', { name: 'Add domain' }).click()
    await page.getByText(domain, { exact: true }).waitFor()
    await page.getByText('Not verified').waitFor()
    // The DNS record to publish is shown; adding it twice is refused.
    await page.getByText(`_circi-verify.${domain} TXT circi-verify=`, { exact: false }).waitFor()
    await field.fill(domain)
    await page.getByRole('button', { name: 'Add domain' }).click()
    await page.getByText(/already on this list/).waitFor()

    // The real DNS lookup finds nothing for a .test name: "not yet".
    await page.getByRole('button', { name: 'Check now' }).click()
    await page.getByText('Not found yet. DNS can take a few minutes to spread.').waitFor()

    // Unverified: no account, no invitation, so a code is neither mailed nor accepted.
    const early = newAccountAt(domain, 'early')
    expect(await requestCode(stack.url, early)).toBe(200)
    expect((await tryCode(stack.url, early, '123456')).status).toBeGreaterThanOrEqual(400)
    expect(await stack.mail.to(early)).toHaveLength(0)

    // The DNS proof can't be produced inside the stack: this is the one fake here. The database
    // row is set the way a successful lookup does (the lookup itself is covered by the server's
    // route test with an injected resolver).
    await stack.sql(`update workspace_domains set verified_at = now() where domain = '${domain}'`)
    await page.reload()
    await page.getByText('Verified', { exact: true }).waitFor()

    const joiner = newAccountAt(domain, 'joiner')
    const session = await signInWithCode(stack.url, stack.mail, joiner)
    const members = (await fullWorkspace(setup.session, workspace())).members
    expect(members.find((m) => m.user.email === joiner)?.role).toBe('member')
    expect((await session.get<{ teams: unknown[] }>('/api/teams')).teams).toBeDefined()
    // No invitation was needed, and none exists for them.
    expect(
      (await fullWorkspace(setup.session, workspace())).invitations.some((i) => i.email === joiner),
    ).toBe(false)

    // A password-less colleague on another domain still gets nothing.
    const outsider = newAccountAt('elsewhere.e2e.test', 'out')
    expect(await requestCode(stack.url, outsider)).toBe(200)
    expect(await stack.mail.to(outsider)).toHaveLength(0)

    // Removing the domain asks first; it stops future joins and leaves current members alone.
    await page.getByRole('button', { name: `Remove ${domain}` }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByText(`Remove ${domain}?`).waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await domainRows()).toBe('1')
    await page.getByRole('button', { name: `Remove ${domain}` }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByText(domain, { exact: true }).waitFor({ state: 'detached' })
    expect(await domainRows()).toBe('0')

    const late = newAccountAt(domain, 'late')
    expect(await requestCode(stack.url, late)).toBe(200)
    expect((await tryCode(stack.url, late, '123456')).status).toBeGreaterThanOrEqual(400)
    expect(await stack.mail.to(late)).toHaveLength(0)
    expect(
      (await fullWorkspace(setup.session, workspace())).members.some(
        (m) => m.user.email === joiner,
      ),
    ).toBe(true)
  })
})

function newAccountAt(domain: string, label: string): string {
  return `${label}-${Math.random().toString(36).slice(2, 8)}@${domain}`
}
