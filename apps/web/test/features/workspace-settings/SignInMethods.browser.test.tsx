import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { SignInMethods } from '#features/workspace-settings/SignInMethods.tsx'
import { fakeFetch, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/workspaces/acme/auth'
const SSO = '/api/workspaces/acme/sso'
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
    fakeFetch({ [`GET ${SSO}`]: { providers: [] }, [`GET ${PATH}`]: () => pending() })
    await renderPage(<SignInMethods workspace="acme" />)
    expect(page.getByRole('heading', { name: 'Sign-in methods' }).elements()).toHaveLength(0)
  })

  it('shows each method as a checkbox in its current state', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${SSO}`]: { providers: [] }, [`GET ${PATH}`]: auth() })
    await renderPage(<SignInMethods workspace="acme" />)
    await expect.element(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
    await expect.element(page.getByRole('checkbox', { name: /^Password/ })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: /^Email code/ })).not.toBeChecked()
  })

  it('shows the GitHub and Google checkboxes only for providers the instance has', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: auth({ instance: { github: true } }),
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await expect.element(page.getByRole('checkbox', { name: /^GitHub/ })).toBeChecked()
    expect(page.getByRole('checkbox', { name: /^Google/ }).elements()).toHaveLength(0)
  })

  it('saves provider changes together on Save, with only the fields that changed', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: auth({ instance: { github: true, google: true } }),
      [`PATCH ${PATH}`]: { settings: {} },
    })
    await renderPage(<SignInMethods workspace="acme" />, { announcer: true })
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect.element(save).toBeDisabled()
    await page.getByRole('checkbox', { name: /^GitHub/ }).click()
    await page.getByRole('checkbox', { name: /^Google/ }).click()
    // Turning a way of signing in off can lock people out: nothing is sent until Save.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    await save.click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PATCH')?.body)
      .toEqual({ signinGithub: false, signinGoogle: true })
  })

  it('puts the saved methods back on Discard', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({ [`GET ${SSO}`]: { providers: [] }, [`GET ${PATH}`]: auth() })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('checkbox', { name: /^Password/ }).click()
    await expect.element(page.getByRole('checkbox', { name: /^Password/ })).not.toBeChecked()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(page.getByRole('checkbox', { name: /^Password/ })).toBeChecked()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('disables a method the instance does not offer, and says so', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: auth({ email: true, instance: { email: false } }),
    })
    await renderPage(<SignInMethods workspace="acme" />)
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
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: () => ({ ...auth(), settings }),
      [`PATCH ${PATH}`]: () => {
        settings = { ...settings, emailLoginEnabled: true }
        return { settings }
      },
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('checkbox', { name: /^Email code/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PATCH')?.body)
      .toEqual({ emailLoginEnabled: true })
    await expect.element(page.getByRole('checkbox', { name: /^Email code/ })).toBeChecked()
  })

  it('shows why a change was refused', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: auth(),
      [`PATCH ${PATH}`]: () =>
        Response.json({ error: 'An owner must be able to sign in' }, { status: 409 }),
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('checkbox', { name: /^Password/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('An owner must be able to sign in')
  })

  it("shows the server's refusal on the checkbox it is about", async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${SSO}`]: { providers: [] },
      [`GET ${PATH}`]: auth(),
      [`PATCH ${PATH}`]: () =>
        Response.json(
          {
            error: 'You signed in with this method',
            fields: {
              passwordLoginEnabled:
                'You signed in with this method. Sign in another way to turn it off.',
            },
          },
          { status: 400 },
        ),
    })
    await renderPage(<SignInMethods workspace="acme" />)
    await page.getByRole('checkbox', { name: /^Password/ }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('You signed in with this method. Sign in another way to turn it off.')
    await expect.element(page.getByRole('checkbox', { name: /^Password/ })).toBeInvalid()
    expect(page.getByRole('alert').elements()).toHaveLength(1)
  })
})
