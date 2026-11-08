import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { SignInMethods } from '#features/members/SignInMethods.tsx'
import { fakeFetch, pending, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/organizations/acme/auth'
const auth = (over: { password?: boolean; email?: boolean; instance?: object } = {}) => ({
  canManage: true,
  settings: { passwordLoginEnabled: over.password ?? true, emailLoginEnabled: over.email ?? false },
  instance: { password: true, email: true, ...over.instance },
})

afterEach(() => restoreFetch())

describe('SignInMethods', () => {
  it('renders nothing until the settings are known', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: () => pending() })
    await renderPage(<SignInMethods org="acme" />)
    expect(page.getByRole('heading', { name: 'Sign-in methods' }).elements()).toHaveLength(0)
  })

  it('shows each method as a checkbox in its current state', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: auth() })
    await renderPage(<SignInMethods org="acme" />)
    await expect.element(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
    await expect.element(page.getByRole('checkbox', { name: 'Password' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: 'Email code' })).not.toBeChecked()
  })

  it('disables a method the instance does not offer, and says so', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: auth({ email: true, instance: { email: false } }) })
    await renderPage(<SignInMethods org="acme" />)
    const email = page.getByRole('checkbox', { name: /Email code/ })
    await expect.element(email).toBeDisabled()
    // Enabled in the settings, but not usable here, so it is not shown as on.
    await expect.element(email).not.toBeChecked()
    await expect.element(page.getByText('Not set up on this instance')).toBeVisible()
  })

  it('saves a change with one field and shows the new state', async () => {
    await page.viewport(1000, 800)
    let settings = { passwordLoginEnabled: true, emailLoginEnabled: false }
    const calls = fakeFetch({
      [`GET ${PATH}`]: () => ({ ...auth(), settings }),
      [`PATCH ${PATH}`]: () => {
        settings = { ...settings, emailLoginEnabled: true }
        return { settings }
      },
    })
    await renderPage(<SignInMethods org="acme" />)
    await page.getByRole('checkbox', { name: 'Email code' }).click()
    await expect.element(page.getByRole('checkbox', { name: 'Email code' })).toBeChecked()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ emailLoginEnabled: true })
  })

  it('shows why a change was refused', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${PATH}`]: auth(),
      [`PATCH ${PATH}`]: () =>
        Response.json({ error: 'An owner must be able to sign in' }, { status: 409 }),
    })
    await renderPage(<SignInMethods org="acme" />)
    await page.getByRole('checkbox', { name: 'Password' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('An owner must be able to sign in')
  })
})
