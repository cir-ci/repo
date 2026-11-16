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
      appearance={{ color: 'slate', icon: null }}
      canManage={canManage}
    />,
    {
      route: '/$workspace/$project/settings/general',
      url: '/acme/web/settings/general',
    },
  )

describe('ProjectIdentity', () => {
  it('disables the name for someone who cannot manage, with no avatar button', async () => {
    await show(false)
    await expect.element(field('Display name')).toBeDisabled()
    expect(page.getByRole('button', { name: 'Change icon and color' }).elements()).toHaveLength(0)
  })

  it('enables it for someone who can, and leaves the address and branch to the Details section', async () => {
    await show(true)
    await expect.element(field('Display name')).toBeEnabled()
    expect(field('URL slug').elements()).toHaveLength(0)
    expect(field('Default branch').elements()).toHaveLength(0)
  })
})
