import { describe, expect, it } from 'vitest'

import { newAccount, signIn } from '#clients/admin.ts'
import { signInThroughUi, signOutThroughUi, submitSignIn } from '#clients/browser.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

/**
 * The stack boots, and a person can claim a fresh install, sign out and sign back in: all through
 * the real UI and the real `/api/auth` endpoints.
 */
describe('fresh stack, local-disk storage', () => {
  const ctx = useStack({ dedicated: true })
  const browser = useBrowser()
  const admin = newAccount('admin')

  it('is healthy and asks for first-run setup', async () => {
    const { stack } = ctx
    const health = await fetch(`${stack.url}/healthz`)
    expect(health.status).toBe(200)
    expect(await (await fetch(`${stack.url}/readyz`)).json()).toMatchObject({ status: 'ok' })
    expect(await (await fetch(`${stack.url}/api/setup`)).json()).toEqual({ needed: true })
    // The dashboard's static app is really in the image (the earlier `webDistPath` regression).
    const html = await (await fetch(stack.url)).text()
    expect(html).toContain('<div id="root">')
  })

  it('first-run setup in the browser creates the admin and signs in', async () => {
    const { stack } = ctx
    const { page } = browser
    await page.goto(stack.url)
    await page.getByRole('heading', { name: 'Set up CirCI' }).waitFor()

    // Step 1: a wrong code is refused with the server's message, and nothing is created.
    await page.getByText('Step 1 of 4').waitFor()
    await page.getByLabel('Setup code').fill('000000-wrong')
    await page.getByLabel('Your name').fill(admin.name)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('That setup code is wrong').waitFor()
    expect(await (await fetch(`${stack.url}/api/setup`)).json()).toEqual({ needed: true })

    await page.getByLabel('Setup code').fill(await stack.setupCode())
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2: the workspace. Submitting it creates the account and the workspace together.
    await page.getByText('Step 2 of 4').waitFor()
    await page.getByLabel('Workspace name').fill('Acme Inc')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3 (the account exists and the page resumes here): the storage check, then the project step,
    // which is skipped to reach the app.
    await page.getByText('Step 3 of 4').waitFor()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('Step 4 of 4').waitFor()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await page.getByRole('button', { name: `Account menu for ${admin.name}` }).waitFor()

    // The instance now has its admin and workspace; setup is closed for good.
    expect(await (await fetch(`${stack.url}/api/setup`)).json()).toEqual({ needed: false })
    const session = await signIn(stack, admin.email, admin.password)
    expect(await session.get('/api/capabilities')).toMatchObject({ canCreateWorkspace: true })
    const retry = await fetch(`${stack.url}/api/setup`, {
      method: 'POST',
      headers: { origin: stack.url, 'content-type': 'application/json' },
      body: JSON.stringify({
        code: await stack.setupCode(),
        name: 'Mallory',
        email: 'mallory@e2e.test',
        password: 'long-enough-password-1',
        workspaceName: 'Evil',
      }),
    })
    expect(retry.status).toBe(404)
  })

  it('signs out, rejects a wrong password, and signs back in', async () => {
    const { stack } = ctx
    const { page } = browser
    await signInThroughUi(page, stack.url, admin)
    await signOutThroughUi(page, admin.name)
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    // Signed out for real: the API refuses the browser's (now empty) session.
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name.includes('session_token') && c.value !== '')).toBe(false)

    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill('not-the-password-123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Incorrect email or password.').waitFor()
    expect(await page.getByRole('button', { name: `Account menu for ${admin.name}` }).count()).toBe(
      0,
    )

    await page.getByLabel('Password').fill(admin.password)
    await submitSignIn(page, admin.name)
  })
})
