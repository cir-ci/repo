import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { UserMenu } from '#features/auth/UserMenu.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const user = { id: 'u1', name: 'Michael Hazan', email: 'michael@acme.dev', image: null }

describe('UserMenu', () => {
  it('is 228px wide with a 28px avatar beside your name and email, and 36px rows', async () => {
    await page.viewport(1000, 800)
    fakeApi({ 'GET /api/capabilities': { body: { instanceAdmin: false } } })
    await renderPage(<UserMenu user={user} />)
    await page.getByRole('button', { name: 'Account menu for Michael Hazan' }).click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    // The popup eases in from a slightly smaller scale.
    await expect.poll(() => menu.element().getBoundingClientRect().width).toBe(228)
    await expect.element(menu.getByText('michael@acme.dev')).toBeVisible()
    const avatar = menu.element().querySelector('[data-type="user"]')
    expect(avatar?.getBoundingClientRect().width).toBe(28)
    const row = page.getByRole('menuitem', { name: 'Profile and sessions' })
    expect(getComputedStyle(row.element()).height).toBe('36px')
  })

  it('lists Keyboard shortcuts on a desktop and leaves it out on a phone', async () => {
    fakeApi({ 'GET /api/capabilities': { body: { instanceAdmin: false } } })
    await page.viewport(1000, 800)
    await renderPage(<UserMenu user={user} />)
    await page.getByRole('button', { name: 'Account menu for Michael Hazan' }).click()
    await expect.element(page.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await page.viewport(390, 844)
    await page.getByRole('button', { name: 'Account menu for Michael Hazan' }).click()
    await expect.element(page.getByRole('menuitem', { name: 'Profile and sessions' })).toBeVisible()
    expect(page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).elements()).toHaveLength(0)
  })
})
