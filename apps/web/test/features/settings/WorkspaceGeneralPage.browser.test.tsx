import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceGeneralPage } from '#features/settings/WorkspaceGeneralPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

afterEach(() => restoreFetch())

const ROUTE = { route: '/workspaces/$workspace/settings', url: '/workspaces/acme/settings' }
const general = (canManage = true, over: object = {}) => ({
  canManage,
  isOwner: canManage,
  name: 'Acme Inc',
  slug: 'acme',
  ...over,
})
const settings = (canManage = true) => ({
  canManage,
  settings: { flakyBlocksMerge: true, retentionDays: 90 },
})
const name = () => page.getByRole('textbox', { name: 'Name' })
const slug = () => page.getByRole('textbox', { name: 'URL slug' })
const save = () => page.getByRole('button', { name: 'Save changes' })

describe('WorkspaceGeneralPage', () => {
  it('shows the name, address, merge defaults and a danger zone', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(name()).toHaveValue('Acme Inc')
    await expect.element(slug()).toHaveValue('acme')
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect
      .element(page.getByRole('switch', { name: /Flaky screenshots block merges/ }))
      .toBeChecked()
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
    await expect.element(save()).toBeDisabled()
  })

  it('lets an admin who is not an owner see why they cannot delete', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(true, { isOwner: false }) },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeDisabled()
    await expect.element(page.getByText('Only an owner can delete the workspace.')).toBeVisible()
  })

  it('deletes only after the name is typed, then leaves the workspace', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'DELETE /api/workspaces/acme': { body: { purgeAt: '2030-02-01T00:00:00.000Z' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await page.getByRole('button', { name: 'Delete workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete Acme Inc?' })
    const confirm = dialog.getByRole('button', { name: 'Delete workspace' })
    await expect.element(confirm).toBeDisabled()
    await dialog.getByRole('textbox', { name: /Type Acme Inc to confirm/ }).fill('Acme')
    await expect.element(confirm).toBeDisabled()
    await dialog.getByRole('textbox', { name: /Type Acme Inc to confirm/ }).fill('Acme Inc')
    await confirm.click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
    expect(api.of('DELETE')[0]?.body).toEqual({ confirm: 'Acme Inc' })
  })

  it('warns that links break when the address changes, and Discard undoes the edit', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await expect.element(page.getByText(/stop working, including bookmarks/)).toBeVisible()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(slug()).toHaveValue('acme')
    await expect
      .element(page.getByText(/stop working, including bookmarks/))
      .not.toBeInTheDocument()
  })

  it('refuses a bad address without asking the server', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('Not Valid')
    await save().click()
    await expect
      .element(page.getByText(/lowercase letters, digits or single hyphens/))
      .toBeVisible()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('saves only the changed field and follows a new address', async () => {
    await page.viewport(1000, 900)
    let current = general()
    const api = fakeApi({
      'GET /api/workspaces/acme': () => ({ body: current }),
      'GET /api/workspaces/acme-co': () => ({ body: current }),
      'GET /api/workspaces/acme/settings': { body: settings() },
      'GET /api/workspaces/acme-co/settings': { body: settings() },
      'PATCH /api/workspaces/acme': () => {
        current = general(true, { slug: 'acme-co' })
        return { body: { name: 'Acme Inc', slug: 'acme-co' } }
      },
    })
    const { router } = await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await save().click()
    await expect.poll(() => router.state.location.pathname).toBe('/workspaces/acme-co/settings')
    expect(api.of('PATCH')[0]?.body).toEqual({ slug: 'acme-co' })
    await expect.element(slug()).toHaveValue('acme-co')
  })

  it('shows why a save was refused', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { status: 409, body: { error: 'That address is taken' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('Acme Corp')
    await save().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('That address is taken')
  })

  it('is read-only for members, with a note', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(false) },
      'GET /api/workspaces/acme/settings': { body: settings(false) },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect
      .element(page.getByText(/Only owners and admins can change workspace settings/))
      .toBeVisible()
    await expect.element(name()).toBeDisabled()
    await expect.element(slug()).toBeDisabled()
    expect(page.getByRole('button', { name: 'Save changes' }).elements()).toHaveLength(0)
  })

  it('says the workspace doesn’t exist for a 404', async () => {
    await page.viewport(1000, 900)
    fakeApi({ 'GET /api/workspaces/acme': { status: 404, body: { error: 'Workspace not found' } } })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByText('This workspace doesn’t exist')).toBeVisible()
  })
})
