import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { CreateWorkspaceDialog } from '#features/instance/CreateWorkspaceDialog.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { workspace } from './fixtures.ts'

const show = (onCreated = vi.fn<(name: string) => void>()) =>
  renderPage(<CreateWorkspaceDialog open onClose={() => {}} onCreated={onCreated} />, {
    route: '/instance/settings',
  })

const submit = () => page.getByRole('dialog').getByRole('button', { name: 'Create workspace' })

describe('CreateWorkspaceDialog', () => {
  it('creates a workspace for an owner, showing the address it gets', async () => {
    const fake = fakeApi({
      'POST /api/instance/workspaces': {
        status: 201,
        body: { workspace: workspace({ id: 'w3', name: 'Acme Mobile', slug: 'acme-mobile' }) },
      },
    })
    const onCreated = vi.fn<(name: string) => void>()
    await show(onCreated)
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await expect.element(page.getByText('Address: acme-mobile')).toBeVisible()
    await page.getByRole('textbox', { name: "Owner's email" }).fill('dana@acme.dev')
    await submit().click()
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('Acme Mobile'))
    expect(fake.of('POST')[0]?.body).toEqual({ name: 'Acme Mobile', ownerEmail: 'dana@acme.dev' })
  })

  it("checks the fields, and shows the server's refusal", async () => {
    const fake = fakeApi({
      'POST /api/instance/workspaces': {
        status: 404,
        body: { error: 'No account has that email' },
      },
    })
    await show()
    await submit().click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await page.getByRole('textbox', { name: "Owner's email" }).fill('nobody@acme.dev')
    await submit().click()
    await expect.element(page.getByText('No account has that email')).toBeVisible()
  })
})
