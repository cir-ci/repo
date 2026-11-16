import { describe, expect, it } from 'vitest'

import { newAccount } from '#clients/admin.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

/**
 * First-run setup as a keyboard and screen-reader user meets it, and as the render-first shell,
 * the stored query cache and the service worker meet a brand-new instance: nothing about a
 * signed-in person exists in the browser until the account is made, focus follows each step, each
 * step is announced, and a reload mid-setup resumes instead of starting over. The steps run in
 * order on one stack (the instance is claimed once).
 */
describe('first-run setup, accessibility and the browser cache', () => {
  const ctx = useStack({ dedicated: true })
  const browser = useBrowser()
  const admin = newAccount('admin')

  /** The text of the page's one polite live region (the announcer). */
  const announced = (page: typeof browser.page) =>
    page.locator('[role="status"][aria-live="polite"]').first().textContent()

  const focused = (page: typeof browser.page) =>
    page.evaluate<string | null>(
      `(() => { const el = document.activeElement; return el ? el.tagName.toLowerCase() + ':' + (el.getAttribute('name') ?? (el.textContent ?? '').slice(0, 20)) : null })()`,
    )

  const hint = (page: typeof browser.page) =>
    page.evaluate<string | null>("localStorage.getItem('circi-session-hint')")

  /** Resolves once some live region on the page says `text`. */
  const announcedText = (page: typeof browser.page, text: string) =>
    page.waitForFunction(
      `[...document.querySelectorAll('[role="status"]')].some((el) => (el.textContent ?? '').includes(${JSON.stringify(text)}))`,
    )

  it('opens on step 1 with the code field focused and nothing of a person stored', async () => {
    const { page } = browser
    await page.goto(ctx.stack.url)
    await page.getByRole('heading', { name: 'Set up CirCI', level: 1 }).waitFor()
    expect(await focused(page)).toBe('input:code')
    // No remembered person to draw the app for, and no stored copy of anyone's data.
    expect(await hint(page)).toBeNull()
    expect(await page.getByRole('contentinfo').textContent()).toBe('Self-hosted CirCI')
  })

  it('lands on the first problem, with the reason tied to the field', async () => {
    const { page } = browser
    await page.goto(ctx.stack.url)
    await page.getByRole('button', { name: 'Continue' }).click()
    const code = page.getByLabel('Setup code')
    await code.waitFor()
    expect(await focused(page)).toBe('input:code')
    expect(await code.getAttribute('aria-invalid')).toBe('true')
    await page.getByText('Enter the setup code').waitFor()

    await code.fill('000000-wrong')
    await page.getByLabel('Your name').fill(admin.name)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('That setup code is wrong').waitFor()
    expect(await focused(page)).toBe('input:code')
    const describedBy = await code.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const reason = await page
      .locator(`[id="${describedBy?.split(' ')[0] ?? ''}"]`)
      .first()
      .textContent()
    expect(reason).toContain('That setup code is wrong')
    expect(await hint(page)).toBeNull()
  })

  it('announces each step, hands focus on, and signs in when the account exists', async () => {
    const { stack } = ctx
    const { page } = browser
    await page.goto(stack.url)
    await page.getByLabel('Setup code').fill(await stack.setupCode())
    await page.getByLabel('Your name').fill(admin.name)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('Step 2 of 4', { exact: true }).waitFor()
    expect(await focused(page)).toBe('input:workspaceName')
    await announcedText(page, 'Step 2 of 4: Workspace')

    // A bad address is refused on the step, with focus on the field.
    await page.getByLabel('Workspace name').fill('Acme Inc')
    await page.getByLabel('Address').fill('Not An Address')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText(/Use lowercase letters/).waitFor()
    expect(await focused(page)).toBe('input:workspaceSlug')
    expect(await hint(page)).toBeNull()

    await page.getByLabel('Address').fill('acme-inc')
    await page.getByRole('button', { name: 'Continue' }).click()
    // The account page is replaced: focus is on the title (not lost to the page), the step and the
    // storage result are spoken, and the session hint now names the new admin.
    await page.getByText('Step 3 of 4', { exact: true }).waitFor()
    await announcedText(page, 'Step 3 of 4: Storage')
    expect(await focused(page)).toBe('h1:Set up CirCI')
    expect(await announced(page)).toContain('Storage: Passing')
    expect(await hint(page)).toContain(admin.email)
  })

  it('resumes at the storage check after a reload, then the token fits a phone', async () => {
    const { stack } = ctx
    const { page } = browser
    // A new tab of the same person: sign in again (the first test's context is gone).
    await page.goto(`${stack.url}/login`)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Step 3 of 4', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('Step 3 of 4', { exact: true }).waitFor()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('Step 4 of 4', { exact: true }).waitFor()
    expect(await focused(page)).toBe('input:name')
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.getByText('Enter a name').waitFor()
    expect(await focused(page)).toBe('input:name')
    await page.getByLabel('Project name').fill('web-app')
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.getByRole('button', { name: 'Done' }).waitFor()
    await announcedText(page, 'shown only once')
    // Focus is inside the new content, and the snippet scrolls in its box instead of the page.
    expect(await page.evaluate<boolean>("document.activeElement?.closest('main') != null")).toBe(
      true,
    )
    expect(
      await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'),
    ).toBe(true)
    await page.getByRole('button', { name: 'Done' }).click()
    // The app opens on the new project (a phone has no account menu button to wait for).
    await page.waitForURL(/\/acme-inc\/web-app/)
  })

  it('never shows setup again: without a session, a reload is the sign-in page', async () => {
    const { stack } = ctx
    const { page, context } = browser
    await page.goto(`${stack.url}/login`)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: `Account menu for ${admin.name}` }).waitFor()
    // The session ends (a cleared cookie, as an expired one would be): the shell finds out at its next check.
    await context.clearCookies()
    await page.reload()
    await page.getByRole('heading', { name: 'Sign in to CirCI', level: 1 }).waitFor()
    expect(await page.getByRole('heading', { name: 'Set up CirCI' }).count()).toBe(0)
    expect(await hint(page)).toBeNull()
  })
})
