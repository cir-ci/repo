import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AccountPage } from '../../../src/features/account/AccountPage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeFetch, restoreFetch, json, pending } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

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
}
const sessions = [session('b', CHROME, 120), session('a', FIREFOX, 5)]

describe('AccountPage', () => {
  it('holds a skeleton while the sessions load, under the page title', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': pending })
    await renderPage(<AccountPage />)
    await expect.element(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('lists the devices, newest first, and offers no sign-out for this one', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': sessions })
    await renderPage(<AccountPage />)
    await expect.element(page.getByText('Firefox on macOS (this device)')).toBeVisible()
    await expect.element(page.getByText('Chrome on Windows')).toBeVisible()
    await expect.element(page.getByText('Ada Lovelace · ada@example.com')).toBeVisible()
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
    await renderPage(<AccountPage />)
    await expect.element(page.getByText('This page couldn’t be loaded')).toBeVisible()
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
    await renderPage(<AccountPage />)
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
    await renderPage(<AccountPage />)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t sign that device out')
  })

  it('asks before signing out everywhere else, and only then does it', async () => {
    const calls = fakeFetch({
      ...signedIn,
      'GET /api/auth/list-sessions': sessions,
      'POST /api/auth/revoke-other-sessions': { status: true },
    })
    await renderPage(<AccountPage />)
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

  it('offers to link GitHub only when the instance has that provider', async () => {
    fakeFetch({
      ...signedIn,
      'GET /api/auth-methods': {
        password: true,
        email: false,
        sso: [{ id: 'github', name: 'GitHub' }],
      },
      'GET /api/auth/list-sessions': sessions,
    })
    await renderPage(<AccountPage />)
    await expect.element(page.getByRole('button', { name: 'Link GitHub' })).toBeVisible()
  })

  it('has no GitHub section without the provider', async () => {
    fakeFetch({ ...signedIn, 'GET /api/auth/list-sessions': sessions })
    await renderPage(<AccountPage />)
    await expect.element(page.getByText('Chrome on Windows')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Link GitHub' })).not.toBeInTheDocument()
  })
})
