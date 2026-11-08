import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createWorkspace,
  type Session,
  createTeam,
  createUserViaCli,
  fullWorkspace,
  newAccount,
  type FakeIdp,
  startFakeIdp,
  withBrowser,
} from '#src/index.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * Single sign-on on the real stack. The identity provider is a fake OIDC server on the host
 * (`host.docker.internal`, reachable from the container and, through the browser's host mapping,
 * from Chromium): CirCI's own code is real, only the provider is a test double, so "works with
 * Okta/Keycloak" is not proved here.
 */
async function fillProvider(page: Page, issuer: string, clientId: string, secret: string) {
  await page.getByLabel('Issuer address').fill(issuer)
  await page.getByLabel('Client id').fill(clientId)
  await page.getByLabel('Client secret').fill(secret)
  await page.getByRole('button', { name: 'Connect provider' }).click()
}

async function disconnect(page: Page, issuer: string) {
  await page.getByRole('button', { name: `Remove ${issuer}` }).click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await dialog.getByText('Disconnect single sign-on?').waitFor()
  await dialog.getByRole('button', { name: 'Remove provider' }).click()
  await page.getByLabel('Issuer address').waitFor()
}

describe('a workspace’s own single sign-on', () => {
  let idp: FakeIdp
  const CLIENT_ID = 'circi-e2e'
  const SECRET = 'right-secret-1234'
  beforeAll(async () => {
    idp = await startFakeIdp(CLIENT_ID, { clientSecret: SECRET, enforceSecret: true })
  })
  afterAll(async () => {
    await idp.close()
  })
  const ctx = useStack({ profile: 'default' })
  const browser = useBrowser()
  const signInUrl = (workspace: string) =>
    `${ctx.stack.url}/workspaces/${workspace}/settings/sign-in`
  /** A workspace's own provider row (its id is `<slug>-sso`): the instance has many. */
  const providers = async (workspace: string) =>
    (
      await ctx.stack.sql(
        `select count(*) from sso_provider where provider_id = '${workspace}-sso'`,
      )
    )[0]?.[0]
  /** A tenant of its own, so no test depends on another's provider. */
  const freshWorkspace = async () => {
    const t = await ctx.tenant()
    return { ...t, workspace: t.workspace.slug }
  }
  /** Connects the fake provider to the workspace through the API. */
  const connect = (session: Session, workspace: string) =>
    session.post(`/api/workspaces/${workspace}/sso`, {
      issuer: idp.issuer,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
    })

  /** The sign-in page's "through your workspace" path, up to the provider's redirect back. */
  async function ssoLogin(page: Page, slug: string) {
    await page.goto(`${ctx.stack.url}/login`)
    await page.getByRole('button', { name: 'Sign in through your workspace' }).click()
    await page.getByLabel('Workspace').fill(slug)
    await page.getByRole('button', { name: 'Continue' }).click()
  }

  it('shows the provider form without autofill, and refuses bad input with messages', async () => {
    const { session, workspace } = await freshWorkspace()
    const page = await browser.as(session)
    await page.goto(signInUrl(workspace))
    await page.getByRole('heading', { name: 'Single sign-on' }).waitFor()
    // Chromium's password manager only autofills what is not marked otherwise: these are the
    // attributes that fixed the earlier bug (the user's own login landing in these fields).
    expect(await page.getByLabel('Client id').getAttribute('autocomplete')).toBe('off')
    expect(await page.getByLabel('Client secret').getAttribute('autocomplete')).toBe('new-password')
    expect(await page.getByLabel('Client id').inputValue()).toBe('')
    expect(await page.getByLabel('Client secret').inputValue()).toBe('')

    await page.getByRole('button', { name: 'Connect provider' }).click()
    await page.getByText('Enter the issuer address').waitFor()
    await page.getByText('Enter the client id').waitFor()
    await page.getByText('Enter the client secret').waitFor()
    await fillProvider(page, 'not a url', 'x', 'y')
    await page.getByText('Enter a full address, like https://login.example.com').waitFor()

    // An address with no provider behind it (the server reads its discovery document).
    await fillProvider(page, `${idp.issuer}/nothing-here`, CLIENT_ID, SECRET)
    await page
      .getByText(/Couldn’t|failed|Invalid|could not|discovery/i)
      .first()
      .waitFor()
    expect(await providers(workspace)).toBe('0')
    // A private address is refused for an https-only server; here the stack allows private ones,
    // but an unreachable one still fails cleanly.
    await page.getByLabel('Issuer address').fill('http://host.docker.internal:9')
    await page.getByRole('button', { name: 'Connect provider' }).click()
    await expect.poll(() => providers(workspace)).toBe('0')
  })

  it('a wrong client secret is accepted at registration but fails at sign-in with a message; disconnecting asks first', async () => {
    const { stack } = ctx
    const { session, workspace } = await freshWorkspace()
    const page = await browser.as(session)
    await page.goto(signInUrl(workspace))
    await page.getByRole('heading', { name: 'Single sign-on' }).waitFor()
    await fillProvider(page, idp.issuer, CLIENT_ID, 'wrong-secret')
    await page.getByText('Connected', { exact: true }).waitFor()

    idp.identity = { sub: 'bad-secret', email: newAccount('x').email, name: 'Nobody' }
    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, workspace)
      await p.getByText('Signing in with that provider didn’t work.').waitFor()
      expect(await p.getByRole('button', { name: /^Account menu for / }).count()).toBe(0)
    })
    expect(
      await stack.sql(`select count(*) from "user" where email = '${idp.identity.email}'`),
    ).toEqual([['0']])

    // Cancel keeps it, confirm removes it.
    await page.getByRole('button', { name: `Remove ${idp.issuer}` }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await providers(workspace)).toBe('1')
    await disconnect(page, idp.issuer)
    expect(await providers(workspace)).toBe('0')
  })

  it('connects a provider (showing where to register it, never the secret), and signs a new person in as a member of that workspace only', async () => {
    const { stack } = ctx
    const setup = await freshWorkspace()
    const workspace = setup.workspace
    const other = await createWorkspace(setup.session, 'Other Workspace')
    await createTeam(setup.session, other.slug, 'Hidden')
    const shown = await createTeam(setup.session, workspace, 'Visible')

    const page = await browser.as(setup.session)
    await page.goto(signInUrl(workspace))
    await page.getByRole('heading', { name: 'Single sign-on' }).waitFor()
    await fillProvider(page, idp.issuer, CLIENT_ID, SECRET)
    await page.getByText('Connected', { exact: true }).waitFor()
    await page.getByText(`${stack.url}/api/auth/sso/callback/${workspace}-sso`).waitFor()
    const listed = await setup.session.get(`/api/workspaces/${workspace}/sso`)
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(await page.content()).not.toContain(SECRET)
    // The form is replaced by the connected provider (one per workspace).
    expect(await page.getByLabel('Client secret').count()).toBe(0)

    const ann = {
      sub: 'emp-ann',
      email: `ann-${Date.now()}@acme-corp.e2e.test`,
      name: 'Ann Employee',
    }
    idp.identity = ann
    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, workspace)
      await p.getByRole('button', { name: `Account menu for ${ann.name}` }).waitFor()
      // Her session opens Acme and nothing else.
      const get = async (path: string) =>
        p.evaluate(async (u) => {
          const r = await fetch(u)
          return { status: r.status, body: await r.text() }
        }, path)
      const teams = JSON.parse((await get('/api/teams')).body) as {
        teams: { workspace: { slug: string }; team: { slug: string } }[]
      }
      expect(teams.teams.map((x) => x.workspace.slug)).toEqual([workspace])
      expect(teams.teams.map((x) => x.team.slug)).toEqual([shown.slug])
      expect((await get(`/api/teams/${other.slug}/hidden`)).status).toBe(404)
      expect(JSON.parse((await get('/api/capabilities')).body)).toMatchObject({
        canCreateWorkspace: false,
      })
      expect((await get(`/api/workspaces/${other.slug}/domains`)).status).toBe(404)
      await p.getByText('Visible').first().waitFor()
    })
    const members = (await fullWorkspace(setup.session, workspace)).members
    expect(members.find((m) => m.user.email === ann.email)).toMatchObject({ role: 'member' })
    const otherMembers = await stack.sql(
      `select count(*) from member m join "user" u on u.id = m.user_id where u.email = '${ann.email}'`,
    )
    expect(otherMembers).toEqual([['1']])
    // The provider's word proves nothing about the address: the account is unverified.
    expect(
      await stack.sql(`select email_verified from "user" where email = '${ann.email}'`),
    ).toEqual([['f']])

    // Back again later: the same provider identity signs into the same account.
    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, workspace)
      await p.getByRole('button', { name: `Account menu for ${ann.name}` }).waitFor()
    })
    expect(await stack.sql(`select count(*) from "user" where email = '${ann.email}'`)).toEqual([
      ['1'],
    ])
  })

  it('refuses an address that already has an account, and a workspace without single sign-on', async () => {
    const { stack } = ctx
    const setup = await freshWorkspace()
    const workspace = setup.workspace
    await connect(setup.session, workspace)
    const existing = await createUserViaCli(stack, { account: newAccount('existing') })
    idp.identity = { sub: 'emp-clash', email: existing.email, name: 'Clash' }
    const before = (await fullWorkspace(setup.session, workspace)).members.length
    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, workspace)
      await p.getByText('Signing in with that provider didn’t work.').waitFor()
      expect(await p.getByRole('button', { name: /^Account menu for / }).count()).toBe(0)
    })
    expect((await fullWorkspace(setup.session, workspace)).members).toHaveLength(before)
    // Nothing was linked to the existing account.
    expect(
      await stack.sql(
        `select count(*) from account a join "user" u on u.id = a.user_id where u.email = '${existing.email}' and a.provider_id <> 'credential'`,
      ),
    ).toEqual([['0']])

    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, 'no-such-workspace')
      await p.getByText('That workspace has no single sign-on set up.').waitFor()
    })
  })

  it('disconnecting removes the provider: nobody can sign in through it any more', async () => {
    const setup = await freshWorkspace()
    const workspace = setup.workspace
    await connect(setup.session, workspace)
    const page = await browser.as(setup.session)
    await page.goto(signInUrl(workspace))
    await disconnect(page, idp.issuer)
    expect(await providers(workspace)).toBe('0')
    idp.identity = { sub: 'emp-ann', email: 'whoever@acme-corp.e2e.test', name: 'Ann Employee' }
    await withBrowser(browser.browser, {}, async (p) => {
      await ssoLogin(p, workspace)
      await p.getByText('That workspace has no single sign-on set up.').waitFor()
    })
  })
})

describe('instance-wide OpenID Connect (AUTH_OIDC_*)', () => {
  let idp: FakeIdp
  beforeAll(async () => {
    idp = await startFakeIdp('instance-client', {
      clientSecret: 'instance-secret-1',
      enforceSecret: true,
    })
  })
  afterAll(async () => {
    await idp.close()
  })
  // Instance-wide sign-in method (environment): a stack of its own.
  const ctx = useStack({
    dedicated: true,
    setup: true,
    env: () => ({
      AUTH_OIDC_ISSUER: idp.issuer,
      AUTH_OIDC_CLIENT_ID: 'instance-client',
      AUTH_OIDC_CLIENT_SECRET: 'instance-secret-1',
      AUTH_OIDC_NAME: 'Acme IdP',
    }),
  })
  const browser = useBrowser()

  it('offers a button, refuses strangers, and lets an invited person in', async () => {
    const { stack, setup } = ctx
    const methods = await (await fetch(`${stack.url}/api/auth-methods`)).json()
    expect(methods).toMatchObject({ sso: [{ id: 'oidc', name: 'Acme IdP' }] })

    const stranger = { sub: 'in-1', email: newAccount('stranger').email, name: 'Stranger' }
    idp.identity = stranger
    await withBrowser(browser.browser, {}, async (p) => {
      await p.goto(`${stack.url}/login`)
      await p.getByRole('button', { name: 'Continue with Acme IdP' }).click()
      await p.getByText('Signing in with that provider didn’t work.').waitFor()
      expect(await p.getByRole('button', { name: /^Account menu for / }).count()).toBe(0)
    })
    expect(
      await stack.sql(`select count(*) from "user" where email = '${stranger.email}'`),
    ).toEqual([['0']])

    // Invited: the provider may now create the account.
    const workspace = await fullWorkspace(setup.session, setup.workspace.slug)
    await setup.session.post('/api/auth/organization/invite-member', {
      email: stranger.email,
      role: 'member',
      organizationId: workspace.id,
    })
    await withBrowser(browser.browser, {}, async (p) => {
      await p.goto(`${stack.url}/login`)
      await p.getByRole('button', { name: 'Continue with Acme IdP' }).click()
      await p.getByRole('button', { name: `Account menu for ${stranger.name}` }).waitFor()
    })
    expect(
      await stack.sql(`select count(*) from "user" where email = '${stranger.email}'`),
    ).toEqual([['1']])
  })
})
