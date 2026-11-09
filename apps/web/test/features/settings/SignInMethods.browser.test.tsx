import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { SignInMethods } from '#features/settings/SignInMethods.tsx'
import { fakeFetch, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/workspaces/acme/auth'
const auth = (over: { password?: boolean; email?: boolean; instance?: object } = {}) => ({
  canManage: true,
  settings: {
    passwordLoginEnabled: over.password ?? true,
    emailLoginEnabled: over.email ?? false,
    signinGithub: true,
    signinGoogle: false,
  },
  instance: { password: true, email: true, github: false, google: false, ...over.instance },
})

describe('SignInMethods', () => {
  it('renders nothing until the settings are known', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: () => pending() })
    await renderPage(<SignInMethods workspace="acme" />)
    expect(page.getByRole('heading', { name: 'Sign-in methods' }).elements()).toHaveLength(0)
  })

  it('shows each method as a switch in its current state', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: auth() })
    await renderPage(<SignInMethods workspace="acme" />)
    await expect.element(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
    await expect.element(page.getByRole('switch', { name: /^Password/ })).toBeChecked()
    await expect.element(page.getByRole('switch', { name: /^Email code/ })).not.toBeChecked()
  })

  it('shows the GitHub and Google switches only for providers the instance has', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: auth({ instance: { github: true } }) })
    await renderPage(<SignInMethods workspace="acme" />)
    await expect.element(page.getByRole('switch', { name: /^GitHub/ })).toBeChecked()
    expect(page.getByRole('switch', { name: /^Google/ }).elements()).toHaveLength(0)
  })

  it('saves a provider switch as it flips, with only that field', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({
      [`GET ${PATH}`]: auth({ instance: { github: true, google: true } }),
      [`PATCH ${PATH}`]: { settings: {} },
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('switch', { name: /^GitHub/ }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PATCH')?.body)
      .toEqual({
        signinGithub: false,
      })
    await page.getByRole('switch', { name: /^Google/ }).click()
    await expect
      .poll(() => calls.findLast((c) => c.method === 'PATCH')?.body)
      .toEqual({
        signinGoogle: true,
      })
  })

  it('disables a method the instance does not offer, and says so', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: auth({ email: true, instance: { email: false } }) })
    await renderPage(<SignInMethods workspace="acme" />)
    const email = page.getByRole('switch', { name: /Email code/ })
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
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('switch', { name: /^Email code/ }).click()
    await expect.element(page.getByRole('switch', { name: /^Email code/ })).toBeChecked()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ emailLoginEnabled: true })
  })

  it('shows why a change was refused', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${PATH}`]: auth(),
      [`PATCH ${PATH}`]: () =>
        Response.json({ error: 'An owner must be able to sign in' }, { status: 409 }),
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('switch', { name: /^Password/ }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('An owner must be able to sign in')
  })
})
