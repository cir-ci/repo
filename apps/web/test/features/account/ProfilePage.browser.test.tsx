import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ProfilePage } from '#features/account/ProfilePage.tsx'
import { fakeFetch, json, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const now = Date.now()
const session = (id: string, agent: string, minutesAgo: number) => ({
  id,
  token: `token-${id}`,
  userAgent: agent,
  ipAddress: '10.0.0.1',
  createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
})
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/130.0'
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36'

const signedIn = {
  'GET /api/auth/get-session': {
    session: {
      token: 'token-a',
      id: 'a',
      userId: 'u1',
      expiresAt: new Date(now + 1e9).toISOString(),
    },
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  'GET /api/auth-methods': { password: true, email: false, sso: [] },
  'GET /api/auth/list-accounts': [
    {
      id: 'a1',
      providerId: 'credential',
      accountId: 'u1',
      updatedAt: new Date(now - 3 * 86_400_000).toISOString(),
    },
  ],
}
const sessions = [session('b', CHROME, 120), session('a', FIREFOX, 5)]

describe('ProfilePage', () => {
  it('holds a skeleton while the sessions load, under the breadcrumb', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': pending })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(page.getByRole('button', { name: 'Sign out', exact: true }).elements()).toHaveLength(0)
  })

  it('lists the devices, newest first, and offers no sign-out for this one', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': sessions })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByText('Firefox on macOS')).toBeVisible()
    await expect.element(page.getByText('This device')).toBeVisible()
    await expect.element(page.getByText('Chrome on Windows')).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.com')
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Firefox on macOS')).toBeLessThan(text.indexOf('Chrome on Windows'))
    expect(page.getByRole('button', { name: 'Sign out', exact: true }).elements()).toHaveLength(1)
  })

  it('says what went wrong and retries', async () => {
    let fail = true
    fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': () => (fail ? json({ message: 'down' }, 500) : sessions),
    })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByText("This page couldn't be loaded")).toBeVisible()
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('Chrome on Windows')).toBeVisible()
  })

  it('signs another device out and refreshes the list', async () => {
    let list = sessions
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': () => list,
      'POST /api/auth/revoke-session': () => {
        list = list.filter((s) => s.id !== 'b')
        return { status: true }
      },
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect.element(page.getByText('Chrome on Windows')).not.toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/auth/revoke-session')?.body).toEqual({
      token: 'token-b',
    })
    // Only this device is left, so there is nothing to sign out of elsewhere.
    await expect
      .element(page.getByRole('button', { name: 'Sign out everywhere else' }))
      .not.toBeInTheDocument()
  })

  it('shows a failed sign-out as an alert', async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/revoke-session': json({ message: 'no' }, 500),
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent("Couldn't sign that device out")
  })

  it('asks before signing out everywhere else, and only then does it', async () => {
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/revoke-other-sessions': { status: true },
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Sign out everywhere else' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Sign out everywhere else?' })
    await expect.element(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('revoke-other-sessions'))).toBe(false)

    await page.getByRole('button', { name: 'Sign out everywhere else' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.filter((c) => c.path.endsWith('revoke-other-sessions'))).toHaveLength(1)
  })

  it('lists linked providers with an unlink, and offers the ones not linked yet', async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth-methods': {
        password: true,
        email: false,
        sso: [
          { id: 'github', name: 'GitHub' },
          { id: 'google', name: 'Google' },
        ],
      },
      'GET /api/auth/list-accounts': [
        {
          id: 'a1',
          providerId: 'credential',
          accountId: 'u1',
          updatedAt: new Date().toISOString(),
        },
        { id: 'a2', providerId: 'github', accountId: '42', updatedAt: new Date().toISOString() },
      ],
      'GET /api/auth/list-sessions': sessions,
    })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByRole('button', { name: 'Unlink GitHub' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Link Google' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Link GitHub' }).elements()).toHaveLength(0)
  })

  it('says so when the server offers nothing to link', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': sessions })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByText(/No other sign-in accounts are available/)).toBeVisible()
  })

  it("unlinks an account only after confirming, and shows the server's refusal", async () => {
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth-methods': {
        password: true,
        email: false,
        sso: [{ id: 'github', name: 'GitHub' }],
      },
      'GET /api/auth/list-accounts': [
        { id: 'a2', providerId: 'github', accountId: '42', updatedAt: new Date().toISOString() },
      ],
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/unlink-account': () =>
        json({ message: "You can't unlink your only account" }, 400),
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Unlink GitHub' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(calls.some((c) => c.path.endsWith('unlink-account'))).toBe(false)
    await page.getByRole('button', { name: 'Unlink GitHub' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Unlink' }).click()
    await expect.element(page.getByText(/You can't unlink your only account/).first()).toBeVisible()
    expect(calls.find((c) => c.path.endsWith('unlink-account'))?.body).toEqual({
      providerId: 'github',
      accountId: '42',
    })
  })

  it('saves a changed name when the field is left, with a Saved note and no Save button', async () => {
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/update-user': { status: true },
    })
    await renderPage(<ProfilePage />, { announcer: true })
    expect(page.getByRole('button', { name: 'Save name' }).elements()).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada King')
    expect(calls.some((c) => c.path.endsWith('update-user'))).toBe(false)
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => calls.find((c) => c.path.endsWith('update-user'))?.body)
      .toEqual({
        name: 'Ada King',
      })
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('readonly')
  })

  it('shows why the name could not be saved, in line', async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/update-user': json({ message: 'Name is too long' }, 400),
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada King')
    await page.getByRole('textbox', { name: 'Email' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
  })

  it('does not send an empty name', async () => {
    const calls = fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': sessions })
    await renderPage(<ProfilePage />)
    await page.getByRole('textbox', { name: 'Name' }).fill('   ')
    await page.getByRole('textbox', { name: 'Email' }).click()
    await expect.element(page.getByText('Enter your name')).toBeVisible()
    expect(calls.some((c) => c.path.endsWith('update-user'))).toBe(false)
  })

  it('changes the password from a dialog after checking it locally', async () => {
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/change-password': { status: true },
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Change password' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await dialog.getByLabelText('Current password').fill('old-password-123')
    await dialog.getByLabelText('New password', { exact: true }).fill('short')
    await dialog.getByLabelText('Confirm new password').fill('different')
    await dialog.getByRole('button', { name: 'Change password' }).click()
    await expect.element(dialog.getByText('Use at least 12 characters')).toBeVisible()
    await expect.element(dialog.getByText("The two passwords don't match")).toBeVisible()
    expect(calls.some((c) => c.path.endsWith('change-password'))).toBe(false)

    await dialog.getByLabelText('New password', { exact: true }).fill('a-much-longer-password')
    await dialog.getByLabelText('Confirm new password').fill('a-much-longer-password')
    await dialog.getByRole('button', { name: 'Change password' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.find((c) => c.path.endsWith('change-password'))?.body).toEqual({
      currentPassword: 'old-password-123',
      newPassword: 'a-much-longer-password',
      revokeOtherSessions: false,
    })
  })

  it("shows the server's reason when the password is wrong", async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/change-password': json({ message: 'Invalid password' }, 400),
    })
    await renderPage(<ProfilePage />)
    await page.getByRole('button', { name: 'Change password' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await dialog.getByLabelText('Current password').fill('nope-nope-nope')
    await dialog.getByLabelText('New password', { exact: true }).fill('a-much-longer-password')
    await dialog.getByLabelText('Confirm new password').fill('a-much-longer-password')
    await dialog.getByRole('button', { name: 'Change password' }).click()
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Invalid password')
  })

  it('has no password section for an account without a password', async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth/list-accounts': [],
      'GET /api/auth/list-sessions': sessions,
    })
    await renderPage(<ProfilePage />)
    await expect.element(page.getByText('Chrome on Windows')).toBeVisible()
    expect(page.getByRole('button', { name: 'Change password' }).elements()).toHaveLength(0)
  })
})
