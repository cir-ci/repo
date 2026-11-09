import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { WorkspaceSwitcher } from '#app/WorkspaceSwitcher.tsx'
import { renderPage } from '#test/support/render.tsx'

const acme = { slug: 'acme', name: 'Acme' }
const globex = { slug: 'globex', name: 'Globex' }

function show(over: Partial<WorkspaceSwitcher.Props> = {}) {
  const onSelect = vi.fn<(workspace: { slug: string; name: string }) => void>()
  const ready = renderPage(
    <WorkspaceSwitcher workspaces={[acme, globex]} current={acme} onSelect={onSelect} {...over} />,
    { route: '/workspaces/$workspace/settings', url: '/workspaces/acme/settings' },
  )
  return { ready, onSelect }
}

describe('WorkspaceSwitcher', () => {
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

  it('offers Create workspace only when the person may create one', async () => {
    await show().ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    expect(page.getByRole('menuitem', { name: 'Create workspace' }).elements()).toHaveLength(0)
  })

  it('creates a workspace from the menu', async () => {
    const onCreate = vi.fn<() => void>()
    await show({ onCreate }).ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await page.getByRole('menuitem', { name: 'Create workspace' }).click()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('opens the current workspace’s settings', async () => {
    const { ready } = show()
    const { router } = await ready
    await page.getByRole('button', { name: 'Workspace: Acme' }).click()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme/settings')
  })
})
