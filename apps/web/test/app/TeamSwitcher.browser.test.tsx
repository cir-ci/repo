import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { TeamSwitcher } from '#app/TeamSwitcher.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { sidebarTeam } from '#test/support/fixtures.ts'
import { renderPage } from '#test/support/render.tsx'

const teams = [
  sidebarTeam({ slug: 'web', name: 'Web App' }),
  sidebarTeam({ slug: 'api', name: 'API' }),
  sidebarTeam({ slug: 'docs', name: 'Docs Site' }),
]

const capabilities = (manageable: { slug: string; name: string }[]) => ({
  'GET /api/capabilities': {
    body: {
      canCreateWorkspace: false,
      instanceAdmin: false,
      manageableWorkspaces: manageable,
      refusingWorkspaces: [],
      mailConfigured: false,
    },
  },
})

const show = (manageable: { slug: string; name: string }[] = []) =>
  renderPage(<TeamSwitcher workspace="acme" teams={teams} current="web" />, {
    route: '/$workspace/$team/settings/reviews',
    url: '/acme/web/settings/reviews',
    api: capabilities(manageable),
  })

const panel = () => page.getByRole('dialog', { name: 'Switch team' })

describe('TeamSwitcher', () => {
  it('lists the teams and marks the current one', async () => {
    await show()
    await page.getByRole('button', { name: 'Switch team' }).click()
    await expect
      .element(panel().getByRole('link', { name: 'Web App' }))
      .toHaveAttribute('aria-current', 'true')
    await expect
      .element(panel().getByRole('link', { name: 'API' }))
      .not.toHaveAttribute('aria-current')
    expect(panel().getByRole('link').elements()).toHaveLength(3)
  })

  it('filters by name and says when nothing matches', async () => {
    await show()
    await page.getByRole('button', { name: 'Switch team' }).click()
    const search = panel().getByRole('searchbox', { name: 'Find a team' })
    await search.fill('docs')
    expect(panel().getByRole('link').elements()).toHaveLength(1)
    await search.fill('zzz')
    expect(panel().getByRole('link').elements()).toHaveLength(0)
    await expect.element(panel().getByText('No team matches “zzz”.')).toBeVisible()
  })

  it('goes to the same settings page of the chosen team and remembers the choice', async () => {
    const { router } = await show()
    await page.getByRole('button', { name: 'Switch team' }).click()
    await panel().getByRole('link', { name: 'Docs Site' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/docs/settings/reviews')
    expect(localStorage.length).toBeGreaterThan(0)
    await expect.element(panel()).not.toBeInTheDocument()
  })

  it('moves with the arrow keys, wraps around, and closes with Escape', async () => {
    await show()
    const trigger = page.getByRole('button', { name: 'Switch team' })
    await trigger.click()
    panel().getByRole('searchbox', { name: 'Find a team' }).element().focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(panel().getByRole('link', { name: 'Docs Site' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(panel().getByRole('searchbox', { name: 'Find a team' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(panel()).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('has no New team entry for someone who manages no workspace', async () => {
    await show([])
    await page.getByRole('button', { name: 'Switch team' }).click()
    await expect.element(panel().getByRole('link', { name: 'Web App' })).toBeVisible()
    expect(panel().getByRole('button', { name: 'New team' }).elements()).toHaveLength(0)
  })

  it('opens the New team dialog for someone who manages a workspace', async () => {
    await show([{ slug: 'acme', name: 'Acme' }])
    await page.getByRole('button', { name: 'Switch team' }).click()
    await panel().getByRole('button', { name: 'New team' }).click()
    expect(useOverlayStore.getState().newTeamOpen).toBe(true)
    await expect.element(panel()).not.toBeInTheDocument()
  })
})
