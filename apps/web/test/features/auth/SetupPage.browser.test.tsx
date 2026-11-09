import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SetupPage } from '#features/auth/SetupPage.tsx'
import { fakeFetch, json } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

async function fillIn() {
  await page.getByRole('textbox', { name: 'Setup code' }).fill(' abc123 ')
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace')
  await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
  await page.getByLabelText('Password').fill('correct horse battery')
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Acme')
}

describe('SetupPage', () => {
  it('explains the first account and where the setup code comes from', async () => {
    await renderPage(<SetupPage />)
    await expect
      .element(page.getByRole('heading', { name: 'Set up CirCI', level: 1 }))
      .toBeVisible()
    await expect.element(page.getByText(/becomes the instance admin/)).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toHaveFocus()
    await expect
      .element(page.getByRole('textbox', { name: 'Setup code' }))
      .toHaveAccessibleDescription(/circi admin setup-code/)
    await expect
      .element(page.getByLabelText('Password'))
      .toHaveAccessibleDescription('At least 12 characters.')
  })

  it('renders the frameless column with the six pieces of the first-run form', async () => {
    await renderPage(<SetupPage />)
    await expect.element(page.getByRole('textbox', { name: 'Setup code' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Your name' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toBeVisible()
    await expect.element(page.getByLabelText('Password')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect.element(page.getByText('Self-hosted CirCI')).toBeVisible()
    expect(page.getByRole('main').element().getBoundingClientRect().width).toBeLessThanOrEqual(360)
  })

  it('creates the account with trimmed values, then signs in', async () => {
    const calls = fakeFetch({
      'POST /api/setup': { email: 'ada@example.com' },
      'POST /api/auth/sign-in/email': { token: 't', user: { id: '1' } },
    })
    await renderPage(<SetupPage />)
    await fillIn()
    await page.getByRole('button', { name: 'Create account' }).click()
    await vi.waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/auth/sign-in/email'))
    expect(calls[0]).toMatchObject({
      path: '/api/setup',
      body: {
        code: 'abc123',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct horse battery',
        workspaceName: 'Acme',
      },
    })
  })

  it('shows the server’s reason when setup is refused, and the form stays usable', async () => {
    fakeFetch({ 'POST /api/setup': json({ error: 'The setup code is wrong' }, 403) })
    await renderPage(<SetupPage />)
    await fillIn()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('The setup code is wrong')
    await expect.element(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })
})
