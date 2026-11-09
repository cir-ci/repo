import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { LoginPage } from '#features/auth/LoginPage.tsx'
import { fakeFetch, json, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const methods = (extra: object = {}) => ({
  'GET /api/setup': { needed: false },
  'GET /api/auth-methods': { password: true, email: false, sso: [], ...extra },
})

describe('LoginPage', () => {
  it('shows nothing while it finds out whether setup is needed', async () => {
    fakeFetch({ 'GET /api/setup': pending, 'GET /api/auth-methods': pending })
    await renderPage(<LoginPage />)
    await expect.element(page.getByRole('heading')).not.toBeInTheDocument()
  })

  it('shows the setup page while the instance has no accounts', async () => {
    fakeFetch({ ...methods(), 'GET /api/setup': { needed: true } })
    await renderPage(<LoginPage />)
    await expect.element(page.getByRole('heading', { name: 'Set up CirCI' })).toBeVisible()
    // The tab says what is shown, not "Sign in".
    await expect.poll(() => document.title).toBe('Set up · CirCI')
  })

  it('is one 400px panel: title, password form and the no-account note', async () => {
    fakeFetch(methods())
    await renderPage(<LoginPage />)
    await expect
      .element(page.getByRole('heading', { name: 'Sign in to CirCI', level: 1 }))
      .toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect
      .element(page.getByText('No account? Ask the person who runs CirCI for one.'))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: /sign-in code/ })).not.toBeInTheDocument()
    const panel = page.getByRole('heading', { name: 'Sign in to CirCI' }).element()
      .parentElement?.parentElement
    expect(panel?.getBoundingClientRect().width).toBeLessThanOrEqual(400)
  })

  it('signs in with the typed email and password', async () => {
    const calls = fakeFetch({
      ...methods(),
      'POST /api/auth/sign-in/email': { token: 't', user: { id: '1' } },
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill(' ada@example.com ')
    await page.getByLabelText('Password').fill('hunter2hunter2')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/api/auth/sign-in/email')?.body).toMatchObject({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
      }),
    )
  })

  it('shows a wrong password as an alert that doesn’t say which part was wrong', async () => {
    fakeFetch({
      ...methods(),
      'POST /api/auth/sign-in/email': json({ message: 'Invalid' }, 401),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await page.getByLabelText('Password').fill('nope')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })

  it('switches to a mailed code and back, when email login is on', async () => {
    fakeFetch(methods({ email: true }))
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await expect.element(page.getByRole('button', { name: 'Email me a code' })).toBeVisible()
    await page.getByRole('button', { name: 'Use a password instead' }).click()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
  })

  it('goes straight to the code step from a mailed link and clears the link after sign-in', async () => {
    window.location.hash = '#signin-email=ada%40example.com&code=123456'
    const calls = fakeFetch({
      ...methods({ email: true }),
      'POST /api/auth/sign-in/email-otp': { token: 't', user: { id: '1' } },
    })
    await renderPage(<LoginPage />)
    await expect.element(page.getByLabelText('6-digit code')).toHaveValue('123456')
    await expect
      .element(page.getByRole('status').getByText(/If ada@example.com has an account/))
      .toBeVisible()
    await page.getByRole('button', { name: 'Sign in' }).click()
    await vi.waitFor(() => expect(window.location.hash).toBe(''))
    expect(calls.find((c) => c.path.endsWith('email-otp'))?.body).toEqual({
      email: 'ada@example.com',
      otp: '123456',
    })
  })

  it('asks for a code, then moves to the code step whatever the answer', async () => {
    const calls = fakeFetch({
      ...methods({ email: true, password: false }),
      'POST /api/auth/email-otp/send-verification-otp': { success: true },
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await expect.element(page.getByLabelText('6-digit code')).toBeVisible()
    expect(calls.some((c) => c.path.endsWith('send-verification-otp'))).toBe(true)
    await page.getByRole('button', { name: 'Use a different email' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  })

  it('explains a wrong code', async () => {
    window.location.hash = '#signin-email=ada%40example.com&code=000000'
    fakeFetch({
      ...methods({ email: true }),
      'POST /api/auth/sign-in/email-otp': json({ message: 'bad' }, 400),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect
      .element(page.getByText('That code is wrong or has expired. Check it, or ask for a new one.'))
      .toBeVisible()
  })

  it('offers one button per single sign-on provider and reports a refusal', async () => {
    window.history.replaceState(null, '', '/?error=access_denied')
    const calls = fakeFetch({
      ...methods({ sso: [{ id: 'github', name: 'GitHub' }] }),
      'POST /api/auth/sign-in/social': json({ message: 'x' }, 500),
    })
    await renderPage(<LoginPage />)
    await expect
      .element(
        page.getByText(
          'Signing in with that provider didn’t work. If you have no account yet, ask to be invited.',
        ),
      )
      .toBeVisible()
    await page.getByRole('button', { name: 'Continue with GitHub' }).click()
    await expect
      .element(page.getByText('Couldn’t reach that provider. Try again, or sign in another way.'))
      .toBeVisible()
    expect(calls.find((c) => c.path.endsWith('sign-in/social'))?.body).toMatchObject({
      provider: 'github',
    })
  })

  it('signs in through a workspace: reveals a field, and says when it has no SSO', async () => {
    const calls = fakeFetch({
      ...methods(),
      'POST /api/auth/sign-in/sso': json({ error: 'none' }, 404),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Sign in through your workspace' }).click()
    await page.getByRole('textbox', { name: 'Workspace' }).fill(' Acme ')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('That workspace has no single sign-on set up.')
    expect(calls.find((c) => c.path.endsWith('sign-in/sso'))?.body).toMatchObject({
      organizationSlug: 'acme',
    })
  })
})
