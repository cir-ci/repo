import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { WorkspaceSwitcher } from '#features/sidebar/WorkspaceSwitcher.tsx'
import { renderPage } from '#test/support/render.tsx'

const acme = { slug: 'acme', name: 'Acme', role: 'owner' } as const
const globex = { slug: 'globex', name: 'Globex', role: 'member' } as const

function show(over: Partial<WorkspaceSwitcher.Props> = {}) {
  const onSelect = vi.fn<(workspace: { slug: string; name: string; role?: string }) => void>()
  const ready = renderPage(
    <WorkspaceSwitcher workspaces={[acme, globex]} current={acme} onSelect={onSelect} {...over} />,
    { route: '/workspaces/$workspace/settings', url: '/workspaces/acme/settings' },
  )
  return { ready, onSelect }
}

describe('WorkspaceSwitcher', () => {
  it("shows a workspace's picture instead of its letter, in the button and the menu", async () => {
    const picture = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    await show({ current: { ...acme, picture }, workspaces: [{ ...acme, picture }, globex] }).ready
    const button = page.getByRole('button', { name: 'Workspace: Acme' })
    await expect.poll(() => button.element().querySelector(`img[src="${picture}"]`)).not.toBeNull()
    await button.click()
    await expect
      .poll(() => page.getByRole('menuitem', { name: 'Acme' }).element().querySelector('img'))
      .not.toBeNull()
    // Without one, the letter stays.
    expect(page.getByRole('menuitem', { name: 'Globex' }).element().querySelector('img')).toBeNull()
  })

  it('is 228px wide with 36px rows, a 20px tile and your role at the right of each workspace', async () => {
    await show().ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await expect.poll(() => menu.element().getBoundingClientRect().width).toBe(228)
    const globexItem = page.getByRole('menuitem', { name: 'Globex' })
    expect(getComputedStyle(globexItem.element()).height).toBe('36px')
    expect(globexItem.element().textContent).toContain('Member')
    expect(page.getByRole('menuitem', { name: 'Acme' }).element().textContent).toContain('Owner')
    expect(
      globexItem.element().querySelector('[data-type="workspace"]')?.getBoundingClientRect().width,
    ).toBe(20)
    await expect
      .element(page.getByRole('menuitem', { name: 'Acme' }))
      .toHaveAttribute('aria-current', 'true')
  })

  it('falls back to the product name when no workspace is open', async () => {
    await show({ current: undefined }).ready
    await expect.element(page.getByText('CirCI')).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('names the open workspace on its button and lists every workspace in a menu', async () => {
    await show().ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Acme' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Globex' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Workspace settings' })).toBeVisible()
  })

  it("opens Members from Workspace settings for people who can't change the settings", async () => {
    const { router } = await renderPage(
      <WorkspaceSwitcher
        workspaces={[acme]}
        current={acme}
        onSelect={vi.fn<() => void>()}
        canManage={false}
      />,
      {
        route: '/workspaces/$workspace/reviews',
        url: '/workspaces/acme/reviews',
        otherRoutes: ['/workspaces/$workspace/settings/members'],
      },
    )
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/members')
  })

  it('selects another workspace with the keyboard', async () => {
    const { ready, onSelect } = show()
    await ready
    page.getByRole('button', { name: 'Workspace: Acme' }).element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Globex' }).click()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(globex)
  })

  it('closes with Escape and gives focus back to the button', async () => {
    await show().ready
    const trigger = page.getByRole('button', { name: 'Workspace: Acme' })
    await trigger.click()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('offers New workspace only when the person may create one', async () => {
    await show().ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    expect(page.getByRole('menuitem', { name: 'New workspace' }).elements()).toHaveLength(0)
  })

  it('creates a workspace from the menu', async () => {
    const onCreate = vi.fn<() => void>()
    await show({ onCreate }).ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await page.getByRole('menuitem', { name: 'New workspace' }).click()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("opens the current workspace's settings", async () => {
    const { ready } = show()
    const { router } = await ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })
})
