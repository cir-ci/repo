import { describe, expect, it } from 'vitest'

import {
  createTeam,
  createUserViaCli,
  fullWorkspace,
  newAccount,
  signIn,
  signInWithCode,
  signInWithCodeThroughUi,
  withBrowser,
  withSessionPage,
  extractCode,
  extractLinks,
  mailIds,
  waitForNewMail,
} from '#src/index.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * Invitations and members on the real stack: invite from the Members page, the mail in Mailpit,
 * accepting signed-out and signed-in, withdrawing, expiring, role changes and removal, all
 * through the real UI and the real better-auth organization API.
 */
describe('invitations and members', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  const workspace = () => ctx.setup.workspace.slug
  const membersUrl = () => `${ctx.stack.url}/workspaces/${workspace()}/members`

  /** Sends an invitation through the form on the Members page. */
  async function inviteInBrowser(
    page: Awaited<ReturnType<typeof browser.as>>,
    email: string,
    role?: 'Admin',
  ) {
    await page.goto(membersUrl())
    await page.getByRole('heading', { name: 'Invite someone' }).waitFor()
    await page.getByLabel('Email', { exact: true }).fill(email)
    if (role) {
      await page.getByRole('combobox', { name: 'Role', exact: true }).click()
      await page.getByRole('option', { name: role }).click()
    }
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await page.getByText(`Invitation sent to ${email}.`).waitFor()
  }

  it('shows the form validation messages and the server’s refusals', async () => {
    const { setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(membersUrl())
    await page.getByRole('heading', { name: 'Invite someone' }).waitFor()
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await page.getByText('Enter an email address').waitFor()
    await page.getByLabel('Email', { exact: true }).fill('not-an-address')
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await page.getByText('That doesn’t look like an email address').waitFor()
    expect((await fullWorkspace(setup.session, workspace())).invitations).toHaveLength(0)

    // Inviting the same address twice, and inviting someone who is already a member.
    const twice = newAccount('twice')
    await inviteInBrowser(page, twice.email)
    await page.getByLabel('Email', { exact: true }).fill(twice.email)
    await page.getByRole('button', { name: 'Send invitation' }).click()
    // better-auth cancels the earlier invitation when the same address is invited again.
    await expect
      .poll(async () => {
        const invitations = (await fullWorkspace(setup.session, workspace())).invitations
        return invitations.filter((i) => i.email === twice.email && i.status === 'pending').length
      })
      .toBe(1)
    // Wait for the form to reset after that send, or it would clear what is typed next.
    await expect.poll(() => page.getByLabel('Email', { exact: true }).inputValue()).toBe('')
    await page.getByLabel('Email', { exact: true }).fill(setup.account.email)
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await page.getByText(/already a member/i).waitFor()
  })

  it('invites from the Members page: the mail has the link and leaks nothing', async () => {
    const { stack, setup } = ctx
    const guest = newAccount('guest')
    const page = await browser.as(setup.session)
    await inviteInBrowser(page, guest.email)
    // Listed as pending, with the role, until it is accepted.
    await page.getByText(guest.email, { exact: true }).waitFor()
    await page
      .getByText(/Member · expires/)
      .first()
      .waitFor()

    const mail = await stack.mail.waitFor({ to: guest.email })
    expect(mail.Subject).toBe(
      `${setup.account.name} invited you to ${setup.workspace.name} on CirCI`,
    )
    expect(mail.To.map((t) => t.Address)).toEqual([guest.email])
    const links = extractLinks(mail)
    const invite = (await fullWorkspace(setup.session, workspace())).invitations.find(
      (i) => i.email === guest.email && i.status === 'pending',
    )
    expect(invite).toBeDefined()
    expect(links).toEqual([
      `${stack.url}/#invite=${invite?.id}&email=${encodeURIComponent(guest.email)}`,
    ])
    expect(mail.Text).toContain('as member')
    expect(mail.Text).toContain('7 days')
    // Nothing secret: no password, no session, no setup code, no server secret, no token.
    for (const secret of [
      setup.account.password,
      'e2e-secret',
      'circi_',
      'session',
      await stack.setupCode(),
    ]) {
      expect(mail.Text).not.toContain(secret)
      expect(mail.HTML).not.toContain(secret)
    }
    // The link is a fragment: the invited address is only visible after the `#`.
    expect(new URL(links[0] ?? '').search).toBe('')
  })

  it('a signed-out invitee opens the link, signs in with a code and joins as a member', async () => {
    const { stack, setup } = ctx
    const guest = newAccount('newbie')
    await inviteInBrowser(await browser.as(setup.session), guest.email)
    const mail = await stack.mail.waitFor({ to: guest.email })
    const [link] = extractLinks(mail)

    await withBrowser(browser.browser, {}, async (page) => {
      await page.goto(link ?? '')
      // The invited address is already in the form; no account exists yet.
      await page.getByRole('button', { name: 'Email me a code' }).waitFor()
      expect(await page.getByLabel('Email').inputValue()).toBe(guest.email)
      const seen = await mailIds(stack.mail, guest.email)
      await page.getByRole('button', { name: 'Email me a code' }).click()
      const code = await waitForNewMail(stack.mail, guest.email, seen, { subject: 'sign-in code' })
      await page.getByLabel('6-digit code').fill(extractCode(code))
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByRole('button', { name: /^Account menu for / }).waitFor()
      // Signed in; the invitation is still waiting for one click.
      await page
        .getByText(`You’re invited to join ${ctx.setup.workspace.name} as member.`)
        .waitFor()
      await page.getByRole('button', { name: 'Join' }).click()
      await page
        .getByText(`You’re invited to join ${ctx.setup.workspace.name} as member.`)
        .waitFor({ state: 'detached' })
    })

    const joined = (await fullWorkspace(setup.session, workspace())).members.find(
      (m) => m.user.email === guest.email,
    )
    expect(joined).toMatchObject({ role: 'member' })
  })

  it('an existing account invited as admin joins with that role (signed in already)', async () => {
    const { stack, setup } = ctx
    const erin = await createUserViaCli(stack, { account: newAccount('erin') })
    const page = await browser.as(setup.session)
    await inviteInBrowser(page, erin.email, 'Admin')
    const mail = await stack.mail.waitFor({ to: erin.email })
    const [link] = extractLinks(mail)
    const session = await signIn(stack, erin.email, erin.password)

    await withSessionPage(browser.browser, session, async (p) => {
      await p.goto(link ?? '')
      await p.getByText(`You’re invited to join ${ctx.setup.workspace.name} as admin.`).waitFor()
      // Before accepting, the new workspace is not theirs to see.
      expect((await session.get<{ teams: unknown[] }>('/api/teams')).teams).toEqual([])
      await p.getByRole('button', { name: 'Join' }).click()
      await p
        .getByText(`You’re invited to join ${ctx.setup.workspace.name} as admin.`)
        .waitFor({ state: 'detached' })
    })
    const member = (await fullWorkspace(setup.session, workspace())).members.find(
      (m) => m.user.email === erin.email,
    )
    expect(member?.role).toBe('admin')
    // Now an admin: may create teams here.
    const team = await createTeam(session, workspace(), 'By Erin')
    expect(team.slug).toBe('by-erin')
  })

  it('refuses an invitation opened by someone else, and one for another address', async () => {
    const { stack, setup } = ctx
    const target = newAccount('target')
    const other = await createUserViaCli(stack, { account: newAccount('other') })
    const page = await browser.as(setup.session)
    await inviteInBrowser(page, target.email)
    const [link] = extractLinks(await stack.mail.waitFor({ to: target.email }))
    const id = new URL(link ?? '').hash.match(/invite=([^&]+)/)?.[1] ?? ''

    const session = await signIn(stack, other.email, other.password)
    // The API says no to the wrong person (the banner explains), and nothing changes.
    expect(
      (await session.request('GET', `/api/auth/organization/get-invitation?id=${id}`)).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await session.request('POST', '/api/auth/organization/accept-invitation', {
          invitationId: id,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    await withSessionPage(browser.browser, session, async (p) => {
      await p.goto(link ?? '')
      await p
        .getByText('This invitation is not for this account, has expired, or was withdrawn.')
        .waitFor()
    })
    const members = (await fullWorkspace(setup.session, workspace())).members
    expect(members.some((m) => m.user.email === other.email)).toBe(false)
  })

  it('withdrawing a pending invitation makes its link stop working', async () => {
    const { stack, setup } = ctx
    const erin = await createUserViaCli(stack, { account: newAccount('wd') })
    const page = await browser.as(setup.session)
    await inviteInBrowser(page, erin.email)
    const [link] = extractLinks(await stack.mail.waitFor({ to: erin.email }))
    const session = await signIn(stack, erin.email, erin.password)

    const row = page
      .getByText(erin.email, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Withdraw"]][1]')
    await row.getByRole('button', { name: 'Withdraw' }).click()
    await row.waitFor({ state: 'detached' })
    const invitation = (await fullWorkspace(setup.session, workspace())).invitations.find(
      (i) => i.email === erin.email,
    )
    expect(invitation?.status).toBe('canceled')

    await withSessionPage(browser.browser, session, async (p) => {
      await p.goto(link ?? '')
      await p
        .getByText('This invitation is not for this account, has expired, or was withdrawn.')
        .waitFor()
      expect(await p.getByRole('button', { name: 'Join' }).count()).toBe(0)
    })
    const id = new URL(link ?? '').hash.match(/invite=([^&]+)/)?.[1] ?? ''
    expect(
      (
        await session.request('POST', '/api/auth/organization/accept-invitation', {
          invitationId: id,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (await fullWorkspace(setup.session, workspace())).members.some(
        (m) => m.user.email === erin.email,
      ),
    ).toBe(false)
  })

  it('an expired invitation cannot be accepted', async () => {
    const { stack, setup } = ctx
    const erin = await createUserViaCli(stack, { account: newAccount('exp') })
    await inviteInBrowser(await browser.as(setup.session), erin.email)
    const [link] = extractLinks(await stack.mail.waitFor({ to: erin.email }))
    const id = new URL(link ?? '').hash.match(/invite=([^&]+)/)?.[1] ?? ''
    const session = await signIn(stack, erin.email, erin.password)

    await stack.sql(
      `update invitation set expires_at = now() - interval '1 hour' where id = '${id}'`,
    )
    await withSessionPage(browser.browser, session, async (p) => {
      await p.goto(link ?? '')
      await p
        .getByText('This invitation is not for this account, has expired, or was withdrawn.')
        .waitFor()
    })
    const res = await session.request('POST', '/api/auth/organization/accept-invitation', {
      invitationId: id,
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(
      (await fullWorkspace(setup.session, workspace())).members.some(
        (m) => m.user.email === erin.email,
      ),
    ).toBe(false)
  })

  it('changes a role from the Members page, and keeps at least one owner', async () => {
    const { stack, setup } = ctx
    const mia = await createUserViaCli(stack, { account: newAccount('mia') })
    await stack.cli('member', 'add', '--org', workspace(), '--email', mia.email, '--role', 'member')
    const miaSession = await signIn(stack, mia.email, mia.password)
    const roleOf = async () =>
      (await fullWorkspace(setup.session, workspace())).members.find(
        (m) => m.user.email === mia.email,
      )?.role

    // A plain member can't manage anything: the API refuses, the UI shows no controls.
    const before = await fullWorkspace(setup.session, workspace())
    const miaMember = before.members.find((m) => m.user.email === mia.email)
    const adminMember = before.members.find((m) => m.user.email === setup.account.email)
    expect(
      (
        await miaSession.request('POST', '/api/auth/organization/update-member-role', {
          memberId: adminMember?.id,
          role: 'member',
          organizationId: before.id,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (await fullWorkspace(setup.session, workspace())).members.find(
        (m) => m.id === adminMember?.id,
      )?.role,
    ).toBe('owner')

    const page = await browser.as(setup.session)
    await page.goto(membersUrl())
    const select = page.getByRole('combobox', { name: `Role of ${mia.name}` })
    await select.click()
    await page.getByRole('option', { name: 'Admin' }).click()
    await expect.poll(roleOf).toBe('admin')
    await page.getByText(`${mia.name} is now Admin`).first().waitFor({ state: 'attached' })
    // And she really is one now: she can create a team.
    await createTeam(miaSession, workspace(), 'Mia made this')
    await select.click()
    await page.getByRole('option', { name: 'Member' }).click()
    await expect.poll(roleOf).toBe('member')
    // Demoted: the same call is refused again.
    expect(
      (await miaSession.request('POST', `/api/workspaces/${workspace()}/teams`, { name: 'Nope' }))
        .status,
    ).toBe(403)

    // The owner has no role picker and no actions menu for themselves; for the last owner the API
    // refuses both demotion and removal.
    expect(
      await page.getByRole('combobox', { name: `Role of ${setup.account.name}` }).count(),
    ).toBe(0)
    const demote = await setup.session.request(
      'POST',
      '/api/auth/organization/update-member-role',
      {
        memberId: adminMember?.id,
        role: 'member',
        organizationId: before.id,
      },
    )
    expect(demote.status).toBeGreaterThanOrEqual(400)
    const removeOwner = await setup.session.request(
      'POST',
      '/api/auth/organization/remove-member',
      {
        memberIdOrEmail: adminMember?.id,
        organizationId: before.id,
      },
    )
    expect(removeOwner.status).toBeGreaterThanOrEqual(400)
    expect(
      (await fullWorkspace(setup.session, workspace())).members.find(
        (m) => m.id === adminMember?.id,
      )?.role,
    ).toBe('owner')
    // An admin can't touch an owner either.
    await setup.session.post('/api/auth/organization/update-member-role', {
      memberId: miaMember?.id,
      role: 'admin',
      organizationId: before.id,
    })
    const adminTriesOwner = await miaSession.request(
      'POST',
      '/api/auth/organization/update-member-role',
      {
        memberId: adminMember?.id,
        role: 'member',
        organizationId: before.id,
      },
    )
    expect(adminTriesOwner.status).toBeGreaterThanOrEqual(400)
  })

  it('removing a member asks first, and their open session loses access at once', async () => {
    const { stack, setup } = ctx
    const team = await createTeam(setup.session, workspace(), 'Secret')
    const lou = await createUserViaCli(stack, { account: newAccount('lou') })
    await stack.cli('member', 'add', '--org', workspace(), '--email', lou.email, '--role', 'member')
    const louSession = await signIn(stack, lou.email, lou.password)
    expect(
      (await louSession.get<{ teams: { team: { slug: string } }[] }>('/api/teams')).teams.map(
        (p) => p.team.slug,
      ),
    ).toContain(team.slug)

    const page = await browser.as(setup.session)
    expect((await louSession.request('GET', `/api/teams/${workspace()}/${team.slug}`)).status).toBe(
      200,
    )
    await withSessionPage(browser.browser, louSession, async (loPage) => {
      await loPage.goto(`${stack.url}/${workspace()}/${team.slug}`)
      await loPage.getByText('Secret', { exact: true }).first().waitFor()

      await page.goto(membersUrl())
      await page.getByRole('button', { name: `Actions for ${lou.name}` }).click()
      await page.getByRole('menuitem', { name: 'Remove from workspace' }).click()
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await dialog.getByText(`Remove ${lou.name}?`).waitFor()
      // Cancelling keeps them.
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      expect(
        (await fullWorkspace(setup.session, workspace())).members.some(
          (m) => m.user.email === lou.email,
        ),
      ).toBe(true)
      expect(
        (await louSession.request('GET', `/api/teams/${workspace()}/${team.slug}`)).status,
      ).toBe(200)

      await page.getByRole('button', { name: `Actions for ${lou.name}` }).click()
      await page.getByRole('menuitem', { name: 'Remove from workspace' }).click()
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
      // Wait for the server's answer, not for the page: while the confirmation dialog is open the
      // rest of the page is aria-hidden, so "the Actions button is gone" is true at once and
      // would let the next request race the removal.
      await expect
        .poll(async () =>
          (await fullWorkspace(setup.session, workspace())).members.some(
            (m) => m.user.email === lou.email,
          ),
        )
        .toBe(false)
      await dialog.waitFor({ state: 'hidden' })
      await page
        .getByRole('button', { name: `Actions for ${lou.name}` })
        .waitFor({ state: 'detached' })

      // The session is still valid, but the data is gone: nothing but "not found".
      const get = await louSession.request('GET', `/api/teams/${workspace()}/${team.slug}`)
      expect([403, 404]).toContain(get.status)
      expect(JSON.stringify(get.body)).not.toContain('Secret')
      const list = await louSession.get<{ teams: unknown[] }>('/api/teams')
      expect(list.teams).toEqual([])
      expect((await louSession.request('GET', `/api/workspaces/${workspace()}/auth`)).status).toBe(
        404,
      )
      await loPage.reload()
      await loPage.getByText('This team doesn’t exist').waitFor()
      expect(await loPage.getByText('Secret', { exact: true }).count()).toBe(0)
    })
    // They can be invited again.
    await inviteInBrowser(page, lou.email)
  })

  it('email-code sign-in works for an invited address with no password (full round trip)', async () => {
    const { stack, setup } = ctx
    const guest = newAccount('code')
    await setup.session.post('/api/auth/organization/invite-member', {
      email: guest.email,
      role: 'member',
      organizationId: (await fullWorkspace(setup.session, workspace())).id,
    })
    const session = await signInWithCode(stack.url, stack.mail, guest.email)
    const me = await session.get<{ user: { email: string } }>('/api/auth/get-session')
    expect(me.user.email).toBe(guest.email)
    await withBrowser(browser.browser, {}, async (page) => {
      await signInWithCodeThroughUi(page, stack.url, stack.mail, guest.email)
    })
  })
})
