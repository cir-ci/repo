import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ProjectIdentity } from '#features/projects/ProjectIdentity.tsx'
import { renderPage } from '#test/support/render.tsx'

const field = (name: string) => page.getByRole('textbox', { name })

const show = (canManage: boolean) =>
  renderPage(
    <ProjectIdentity
      workspace="acme"
      project="web"
      name="Web App"
      slug="web"
      defaultBranch="main"
      appearance={{ color: 'slate', icon: null }}
      canManage={canManage}
    />,
    {
      route: '/$workspace/$project/settings/general',
      url: '/acme/web/settings/general',
    },
  )

describe('ProjectIdentity', () => {
  it('disables the three fields for someone who cannot manage, with no ✓ and no avatar button', async () => {
    await show(false)
    await expect.element(field('Display name')).toBeDisabled()
    await expect.element(field('URL slug')).toBeDisabled()
    await expect.element(field('Default Branch')).toBeDisabled()
    expect(page.getByRole('button', { name: /^Save / }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Change icon and colour' }).elements()).toHaveLength(0)
  })

  it('enables them for someone who can', async () => {
    await show(true)
    await expect.element(field('Display name')).toBeEnabled()
    await expect.element(field('URL slug')).toBeEnabled()
    await expect.element(field('Default Branch')).toBeEnabled()
  })
})
