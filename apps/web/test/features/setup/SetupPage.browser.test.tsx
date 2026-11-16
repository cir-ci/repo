import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SetupPage } from '#features/setup/SetupPage.tsx'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { expectOnePrimaryPerArea } from '#test/support/primary-buttons.ts'
import { renderPage } from '#test/support/render.tsx'

async function fillAccount(overrides: { code?: string; password?: string } = {}) {
  await page.getByRole('textbox', { name: 'Setup code' }).fill(overrides.code ?? ' abc123 ')
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace')
  await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
  await page.getByLabelText('Password').fill(overrides.password ?? 'correct horse battery')
}

const next = () => page.getByRole('button', { name: 'Continue' }).click()

async function toWorkspaceStep() {
  await fillAccount()
  await next()
  await expect.element(page.getByText('Step 2 of 4')).toBeVisible()
}

const routes = () => ({
  'POST /api/setup/code': new Response(null, { status: 204 }),
  'POST /api/setup': json({ email: 'ada@example.com', workspace: { slug: 'acme' } }, 201),
  'POST /api/auth/sign-in/email': { token: 't', user: { id: '1' } },
})

describe('SetupPage, the account step', () => {
  it('is step 1 of 4, with the setup code field focused and its hint', async () => {
    await renderPage(<SetupPage />)
    await expect
      .element(page.getByRole('heading', { name: 'Set up CirCI', level: 1 }))
      .toBeVisible()
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible()
    // The progress bar is the subtitle; a paragraph can't hold its divs.
    expect(page.getByText('Step 1 of 4').element().closest('p')).toBeNull()
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toHaveFocus()
    await expect
      .element(page.getByRole('textbox', { name: 'Setup code' }))
      .toHaveAccessibleDescription(/circi admin setup-code/)
    await expect
      .element(page.getByLabelText('Password'))
      .toHaveAccessibleDescription('At least 12 characters.')
    await expect.element(page.getByText('Self-hosted CirCI')).toBeVisible()
    // The workspace comes in the next step; there is no way back from the first.
    expect(page.getByRole('textbox', { name: 'Workspace name' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Back' }).elements()).toHaveLength(0)
    expect(page.getByRole('main').element().getBoundingClientRect().width).toBeLessThanOrEqual(360)
  })

  it('says what is missing or wrong in each field, and asks the server nothing', async () => {
    const calls = fakeFetch({})
    await renderPage(<SetupPage />)
    await next()
    await expect.element(page.getByText('Enter the setup code')).toBeVisible()
    await expect.element(page.getByText('Enter your name')).toBeVisible()
    await expect.element(page.getByText('Enter your email')).toBeVisible()
    await expect.element(page.getByText('Enter a password')).toBeVisible()

    await fillAccount({ password: 'short' })
    await page.getByRole('textbox', { name: 'Email' }).fill('not an email')
    await next()
    await expect.element(page.getByText('Enter a valid email address')).toBeVisible()
    await expect.element(page.getByText('Use at least 12 characters')).toBeVisible()
    expect(calls).toEqual([])
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible()
  })

  it('checks the code with the server before the next step, and says when it is wrong', async () => {
    const calls = fakeFetch({
      'POST /api/setup/code': (call: { body: unknown }) =>
        typeof call.body === 'object' &&
        call.body !== null &&
        'code' in call.body &&
        call.body.code === 'good'
          ? new Response(null, { status: 204 })
          : json({ error: 'That setup code is wrong. Find it in the server log.' }, 403),
    })
    await renderPage(<SetupPage />)
    await fillAccount({ code: 'bad' })
    await next()
    await expect.element(page.getByText(/That setup code is wrong/)).toBeVisible()
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible()

    await page.getByRole('textbox', { name: 'Setup code' }).fill(' good ')
    await next()
    await expect.element(page.getByText('Step 2 of 4')).toBeVisible()
    expect(calls.at(-1)).toMatchObject({ path: '/api/setup/code', body: { code: 'good' } })
  })
})

describe('SetupPage, keyboard and screen reader', () => {
  it('moves focus to the first field with a problem when a submit is refused', async () => {
    fakeFetch({
      'POST /api/setup/code': json(
        { error: 'That setup code is wrong. Find it in the server log.' },
        403,
      ),
    })
    await renderPage(<SetupPage />)
    await next()
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toHaveFocus()
    await expect
      .element(page.getByRole('textbox', { name: 'Setup code' }))
      .toHaveAccessibleDescription('Enter the setup code')
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toBeInvalid()

    // Only the email is wrong: focus skips the fields that are fine.
    await fillAccount()
    await page.getByRole('textbox', { name: 'Email' }).fill('nope')
    await next()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveFocus()

    // The server refusing the code puts focus back on the code field, with the reason.
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
    await next()
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toHaveFocus()
    await expect
      .element(page.getByRole('textbox', { name: 'Setup code' }))
      .toHaveAccessibleDescription(/That setup code is wrong/)
  })

  it('moves focus to the workspace field with a problem, and announces each step', async () => {
    fakeFetch(routes())
    await renderPage(<SetupPage />, { announcer: true })
    // The first load is not announced (the page title is); a later step is.
    expect(page.getByRole('status').element().textContent).toBe('')
    await toWorkspaceStep()
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Step 2 of 4: Workspace' }))
      .toBeInTheDocument()
    await next()
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toHaveFocus()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme')
    await page.getByRole('textbox', { name: 'Address' }).fill('Not An Address')
    await next()
    await expect.element(page.getByRole('textbox', { name: 'Address' })).toHaveFocus()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Step 1 of 4: Account' }))
      .toBeInTheDocument()
  })

  it('has no banner gap above the fields, and the footer is a landmark', async () => {
    await renderPage(<SetupPage />)
    const progress = page.getByText('Step 1 of 4').element().getBoundingClientRect()
    const field = page
      .getByRole('textbox', { name: 'Setup code' })
      .element()
      .getBoundingClientRect()
    // Progress bar, then the first label (about 20px) and its field: the design has no reserved message row.
    expect(field.top - progress.bottom).toBeLessThan(80)
    expect(page.getByRole('contentinfo').element().textContent).toBe('Self-hosted CirCI')
    expectOnePrimaryPerArea()
  })
})

describe('SetupPage, the workspace step', () => {
  it('follows the name with the address, until the address is typed', async () => {
    fakeFetch(routes())
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toHaveFocus()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme Inc')
    await expect.element(page.getByRole('textbox', { name: 'Address' })).toHaveValue('acme-inc')
    await page.getByRole('textbox', { name: 'Address' }).fill('acme')
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme Incorporated')
    await expect.element(page.getByRole('textbox', { name: 'Address' })).toHaveValue('acme')
  })

  it('validates the name and the address', async () => {
    const calls = fakeFetch(routes())
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await next()
    await expect.element(page.getByText('Enter a name')).toBeVisible()

    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme')
    await page.getByRole('textbox', { name: 'Address' }).fill('Not An Address')
    await next()
    await expect.element(page.getByText(/Use lowercase letters, digits/)).toBeVisible()
    expect(calls.some((c) => c.path === '/api/setup')).toBe(false)
  })

  it('goes Back with the first step as it was left', async () => {
    fakeFetch(routes())
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: 'Your name' }))
      .toHaveValue('Ada Lovelace')
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.com')
    await expect.element(page.getByLabelText('Password')).toHaveValue('correct horse battery')
    // And forward again without asking for anything twice.
    await next()
    await expect.element(page.getByText('Step 2 of 4')).toBeVisible()
  })

  it('creates the account and the workspace in one request, then signs in', async () => {
    const calls = fakeFetch(routes())
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill(' Acme Inc ')
    await next()
    await vi.waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/auth/sign-in/email'))
    expect(calls.filter((c) => c.path === '/api/setup')).toHaveLength(1)
    expect(calls.find((c) => c.path === '/api/setup')).toMatchObject({
      body: {
        code: 'abc123',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct horse battery',
        workspaceName: 'Acme Inc',
        workspaceSlug: 'acme-inc',
        steps: true,
      },
    })
  })

  it("shows the server's reason and stays on the step when it refuses the workspace", async () => {
    fakeFetch({
      ...routes(),
      'POST /api/setup': json({ error: 'A workspace at /acme already exists.' }, 409),
    })
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme')
    await next()
    await expect.element(page.getByText(/A workspace at \/acme already exists/)).toBeVisible()
    await expect.element(page.getByText('Step 2 of 4')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('returns to the first step when the code turns out to be wrong at the end', async () => {
    fakeFetch({
      ...routes(),
      'POST /api/setup': json(
        { error: 'That setup code is wrong. Find it in the server log.' },
        403,
      ),
    })
    await renderPage(<SetupPage />)
    await toWorkspaceStep()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme')
    await next()
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible()
    await expect.element(page.getByText(/That setup code is wrong/)).toBeVisible()
  })
})
