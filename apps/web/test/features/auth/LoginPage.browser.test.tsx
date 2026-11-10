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

  it('is one frameless 360px column: logo, title, host, form, invitation note, footer', async () => {
    fakeFetch(methods())
    await renderPage(<LoginPage />)
    const title = page.getByRole('heading', { name: 'Sign in to CirCI', level: 1 })
    await expect.element(title).toBeVisible()
    await expect.element(page.getByText(window.location.host, { exact: true })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect
      .element(
        page.getByText('Got an invitation? Open the link in the email to join your workspace.'),
      )
      .toBeVisible()
    await expect.element(page.getByText('Self-hosted CirCI')).toBeVisible()
    const column = page.getByRole('main').element()
    expect(column.getBoundingClientRect().width).toBeLessThanOrEqual(360)
    expect(column.id).toBe('content')
    // No card: the column's own box has no border or fill.
    expect(getComputedStyle(column).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // 36px controls.
    expect(getComputedStyle(page.getByLabelText('Password').element()).height).toBe('36px')
    expect(getComputedStyle(page.getByRole('button', { name: 'Sign in' }).element()).height).toBe(
      '36px',
    )
    await expect.poll(() => document.title).toBe('Sign in to CirCI')
  })

  it('hides the provider buttons and the divider when none are configured, and shows one per provider', async () => {
    fakeFetch(methods())
    const { screen } = await renderPage(<LoginPage />)
    await expect.element(page.getByLabelText('Password')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: /Continue with (GitHub|Google)/ }))
      .not.toBeInTheDocument()
    await expect.element(page.getByText('or with email')).not.toBeInTheDocument()
    await screen.unmount()
    fakeFetch(
      methods({
        sso: [
          { id: 'github', name: 'GitHub' },
          { id: 'google', name: 'Google' },
        ],
      }),
    )
    await renderPage(<LoginPage />)
    await expect.element(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await expect.element(page.getByText('or with email')).toBeVisible()
  })

  it('offers “Email me a code” beside the password only when email login is on', async () => {
    fakeFetch(methods())
    const { screen } = await renderPage(<LoginPage />)
    await expect.element(page.getByLabelText('Password')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Email me a code' }))
      .not.toBeInTheDocument()
    await screen.unmount()
    fakeFetch(methods({ email: true }))
    await renderPage(<LoginPage />)
    await expect.element(page.getByRole('button', { name: 'Email me a code' })).toBeVisible()
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
    // The banner's room is reserved, and the fields keep what was typed.
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.com')
    await expect.element(page.getByLabelText('Password')).toHaveValue('nope')
  })

  it('reserves room for the error banner, so the fields do not move when it appears', async () => {
    fakeFetch({
      ...methods(),
      'POST /api/auth/sign-in/email': json({ message: 'Invalid' }, 401),
    })
    await renderPage(<LoginPage />)
    const field = page.getByRole('textbox', { name: 'Email' })
    await expect.element(field).toBeVisible()
    const before = field.element().getBoundingClientRect().top
    await page.getByLabelText('Password').fill('nope')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.element(page.getByRole('alert')).toBeVisible()
    expect(field.element().getBoundingClientRect().top).toBe(before)
  })

  it('switches to a mailed code and back, when email login is on', async () => {
    fakeFetch(methods({ email: true }))
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await expect.element(page.getByRole('button', { name: 'Email me a code' })).toBeVisible()
    await page.getByRole('button', { name: 'Use a password instead' }).click()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
  })

  it('keeps the typed email when switching to a code after a wrong password, and back', async () => {
    fakeFetch({
      ...methods({ email: true }),
      'POST /api/auth/sign-in/email': json({ message: 'Invalid' }, 401),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await page.getByLabelText('Password').fill('nope')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Incorrect email or password.')
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.com')
    await page.getByRole('button', { name: 'Use a password instead' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.com')
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
      .element(page.getByText('That code is wrong or has expired. Check it, or send a new one.'))
      .toBeVisible()
  })

  it('lets you send a new code from the code step, after a wait', async () => {
    const calls = fakeFetch({
      ...methods({ email: true, password: false }),
      'POST /api/auth/email-otp/send-verification-otp': { success: true },
      'POST /api/auth/sign-in/email-otp': json({ message: 'bad' }, 400),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await page.getByRole('button', { name: 'Email me a code' }).click()
    await page.getByLabelText('6-digit code').fill('000000')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect
      .element(page.getByText('That code is wrong or has expired. Check it, or send a new one.'))
      .toBeVisible()
    // Just sent one: the server limits how many it will send, so the button waits.
    const again = page.getByRole('button', { name: /^Send a new code/ })
    await expect.element(again).toBeDisabled()
    await expect.poll(() => again.element().textContent).toMatch(/Send\s+a\s+new\s+code\s+in/)
    expect(calls.filter((c) => c.path.endsWith('send-verification-otp'))).toHaveLength(1)
  })

  it('sends a new code once the wait is over, and says so', async () => {
    window.location.hash = '#signin-email=ada%40example.com&code=000000'
    const calls = fakeFetch({
      ...methods({ email: true }),
      'POST /api/auth/email-otp/send-verification-otp': { success: true },
    })
    await renderPage(<LoginPage />)
    // Arriving by the mailed link starts no wait: nothing was requested from this page.
    const again = page.getByRole('button', { name: 'Send a new code' })
    await expect.element(again).toBeEnabled()
    await again.click()
    await expect.element(page.getByText(/We sent a new code to ada@example\.com/)).toBeVisible()
    expect(calls.filter((c) => c.path.endsWith('send-verification-otp'))).toHaveLength(1)
    expect(calls.find((c) => c.path.endsWith('send-verification-otp'))?.body).toEqual({
      email: 'ada@example.com',
      type: 'sign-in',
    })
    await expect.element(page.getByRole('button', { name: /Send a new code in/ })).toBeDisabled()
  })

  it('shows the rate limit when asking for a new code is refused', async () => {
    window.location.hash = '#signin-email=ada%40example.com&code=000000'
    fakeFetch({
      ...methods({ email: true }),
      'POST /api/auth/email-otp/send-verification-otp': json({ message: 'Too many' }, 429),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Send a new code' }).click()
    await expect
      .element(page.getByText('Too many attempts. Wait a minute and try again.'))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: /Send a new code in/ })).toBeDisabled()
  })

  it('says the address is the wrong one when the server refuses the origin', async () => {
    fakeFetch({
      ...methods(),
      'POST /api/auth/sign-in/email': json(
        { code: 'INVALID_ORIGIN', message: 'Invalid origin' },
        403,
      ),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await page.getByLabelText('Password').fill('hunter2hunter2')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect
      .poll(() => page.getByRole('alert').element().textContent)
      .toMatch(/This server doesn.t accept sign-ins from this address\./)
    expect(page.getByText(/Check your connection/).elements()).toHaveLength(0)
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

  it('opens the workspace step from “Continue with SSO”, and says when it has no SSO', async () => {
    const calls = fakeFetch({
      ...methods({ sso: [{ id: 'github', name: 'GitHub' }] }),
      'POST /api/auth/sign-in/sso': json({ error: 'none' }, 404),
    })
    await renderPage(<LoginPage />)
    await page.getByRole('button', { name: 'Continue with SSO' }).click()
    // The step replaces the buttons and the email form.
    await expect
      .element(page.getByRole('button', { name: 'Continue with GitHub' }))
      .not.toBeInTheDocument()
    await expect.element(page.getByLabelText('Password')).not.toBeInTheDocument()
    await page.getByRole('textbox', { name: 'Workspace' }).fill(' Acme ')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('That workspace has no single sign-on set up.')
    expect(calls.find((c) => c.path.endsWith('sign-in/sso'))?.body).toMatchObject({
      organizationSlug: 'acme',
    })
    await page.getByRole('button', { name: 'Back to sign in' }).click()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
  })
})
