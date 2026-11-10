import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceGeneralPage } from '#features/workspace-settings/WorkspaceGeneralPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const ROUTE = {
  route: '/workspaces/$workspace/settings',
  url: '/workspaces/acme/settings',
  otherRoutes: ['/workspaces/$workspace/settings/members'],
}
const general = (canManage = true, over: object = {}) => ({
  canManage,
  isOwner: canManage,
  name: 'Acme Inc',
  slug: 'acme',
  picture: null,
  ...over,
})
const settings = (canManage = true) => ({
  canManage,
  settings: { flakyBlocksMerge: true, retentionDays: 90 },
  teams: [
    { slug: 'web', name: 'Web app', flakyBlocksMerge: null },
    { slug: 'marketing', name: 'marketing-site', flakyBlocksMerge: false },
  ],
})
const name = () => page.getByRole('textbox', { name: 'Name' })
const slug = () => page.getByRole('textbox', { name: 'URL slug' })
const save = () => page.getByRole('button', { name: 'Save changes' })

describe('WorkspaceGeneralPage', () => {
  it('shows the picture row: the first letter without a picture, Upload for a manager', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByText('Picture', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Upload picture' })).toBeEnabled()
    expect(page.getByRole('button', { name: 'Remove' }).elements()).toHaveLength(0)
  })

  // A 1×1 PNG the browser can load (the shared avatar draws the picture only once it has).
  const PICTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

  it('shows the picture, replaces it and removes it', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': {
        body: general(true, { picture: PICTURE }),
      },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PUT /api/workspaces/acme/picture': {
        body: { picture: '/api/workspaces/acme/picture?v=def' },
      },
      'DELETE /api/workspaces/acme/picture': { body: { picture: null } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByRole('button', { name: 'Replace picture' })).toBeVisible()
    // The avatar shows the picture once it has loaded.
    await expect.poll(() => document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    if (!input) throw new Error('no file input')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => api.of('PUT')).toHaveLength(1)

    await page.getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
  })

  it('refuses a file of the wrong type or size before sending it', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PUT /api/workspaces/acme/picture': { body: { picture: 'x' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByRole('button', { name: 'Upload picture' })).toBeVisible()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('no file input')
    const send = (file: File) => {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    send(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))
    await expect.element(page.getByText('Use a PNG, JPEG or WebP image')).toBeVisible()
    send(new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    await expect.element(page.getByText('Use an image of at most 1 MB')).toBeVisible()
    expect(api.of('PUT')).toHaveLength(0)
  })

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
      .element(page.getByRole('checkbox', { name: /Flaky-only changes block merging/ }))
      .toBeChecked()
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
    // Nothing to save yet, in the address form or the merge gate defaults.
    for (const button of page.getByRole('button', { name: 'Save changes' }).elements())
      expect(button).toBeDisabled()
    // The merge gate default says who follows it and who overrides it.
    await expect.element(page.getByText('1 team inherits this, 1 overrides it')).toBeVisible()
    await expect.element(page.getByText('marketing-site: off')).toBeVisible()
  })

  it('keeps the danger zone in its own section, after the others', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    const danger = page.getByRole('region', { name: 'Danger zone' })
    await expect.element(danger).toBeVisible()
    await expect.element(danger).toHaveAttribute('data-tone', 'danger')
    await expect.element(danger.getByText(/restore it/)).toBeVisible()
    const headings = page.getByRole('heading', { level: 2 }).elements()
    expect(headings.at(-1)?.textContent).toBe('Danger zone')
  })

  it("disables deleting for an admin who isn't an owner", async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(true, { isOwner: false }) },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeDisabled()
  })

  it('deletes only after the slug is typed, then leaves the workspace', async () => {
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
    const field = dialog.getByRole('textbox', { name: 'Type acme to confirm' })
    await expect.element(confirm).toBeDisabled()
    // The display name is not the confirmation: the slug is.
    await field.fill('Acme Inc')
    await expect.element(confirm).toBeDisabled()
    await field.fill('ac')
    await expect.element(confirm).toBeDisabled()
    await field.fill('acme')
    await expect.element(confirm).toBeEnabled()
    await confirm.click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
    expect(api.of('DELETE')[0]?.body).toEqual({ confirm: 'acme' })
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
    await page
      .getByRole('form', { name: 'Address' })
      .getByRole('button', { name: 'Discard' })
      .click()
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
    await save().first().click()
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
    await save().first().click()
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
    await slug().fill('taken')
    await save().first().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('That address is taken')
  })

  it('saves the name by itself when the field is left, with a Saved note', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { body: { name: 'Acme Corp', slug: 'acme' } },
    })
    await renderPage(<WorkspaceGeneralPage />, { ...ROUTE, announcer: true })
    await expect.element(name()).toHaveValue('Acme Inc')
    await name().fill('Acme Corp')
    expect(api.of('PATCH')).toHaveLength(0)
    await slug().click()
    await expect.poll(() => api.of('PATCH')).toHaveLength(1)
    // Only the name: the address waits for its own Save.
    expect(api.of('PATCH')[0]?.body).toEqual({ name: 'Acme Corp' })
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  })

  it('keeps an address being typed when the name is saved, and shows a failed name in line', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { status: 400, body: { error: 'Name is too long' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await name().fill('Acme Corp')
    await slug().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    await expect.element(slug()).toHaveValue('acme-co')
    await expect.element(page.getByText(/stop working, including bookmarks/)).toBeVisible()
  })

  it('refuses an empty name on the field without asking the server', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('  ')
    await slug().click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('sends members to Members instead of showing the settings', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(false) },
      'GET /api/workspaces/acme/settings': { body: settings(false) },
    })
    const { router } = await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/members')
    expect(name().elements()).toHaveLength(0)
  })

  it("says the workspace doesn't exist for a 404", async () => {
    await page.viewport(1000, 900)
    fakeApi({ 'GET /api/workspaces/acme': { status: 404, body: { error: 'Workspace not found' } } })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByText("This workspace doesn't exist")).toBeVisible()
  })
})
