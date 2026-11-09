import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspacesPage } from '#features/instance/WorkspacesPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { settingsFixture, workspace } from './fixtures.ts'

const show = () => renderPage(<WorkspacesPage />, { route: '/instance/workspaces' })

const LIST = {
  'GET /api/instance/workspaces': {
    body: {
      workspaces: [
        workspace(),
        workspace({
          id: 'w2',
          name: 'Design Guild',
          slug: 'design-guild',
          teamCount: 0,
          memberCount: 1,
          storageBytes: 0,
        }),
      ],
    },
  },
  'GET /api/instance/settings': { body: settingsFixture() },
}

describe('the workspaces page', () => {
  it('lists workspaces with members, teams and storage', async () => {
    fakeApi(LIST)
    await show()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible()
    await expect.element(page.getByText('6 members')).toBeVisible()
    await expect.element(page.getByText('3 teams')).toBeVisible()
    await expect.element(page.getByText('1.5 MB')).toBeVisible()
    await expect.element(page.getByText('1 member', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Instance admins only')).toBeVisible()
  })

  it('marks a deleted workspace with its days left, and restores it', async () => {
    let deleted = true
    const fake = fakeApi({
      'GET /api/instance/workspaces': () => ({
        body: {
          workspaces: [
            workspace({
              id: 'w9',
              name: 'Old Co',
              slug: 'old-co',
              ...(deleted ? { deletedAt: '2026-11-01T00:00:00.000Z', daysLeft: 22 } : {}),
            }),
          ],
        },
      }),
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/workspaces/w9/restore': () => {
        deleted = false
        return { body: { workspace: workspace({ id: 'w9' }) } }
      },
    })
    await show()
    await expect.element(page.getByText('Deleted · 22 days left')).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect.element(page.getByText('Deleted · 22 days left')).not.toBeInTheDocument()
    await expect.element(page.getByText('Restored the workspace Old Co.')).toBeVisible()
  })

  it('purges a deleted workspace at once after its address is typed', async () => {
    const fake = fakeApi({
      'GET /api/instance/workspaces': {
        body: {
          workspaces: [
            workspace({
              id: 'w9',
              name: 'Old Co',
              slug: 'old-co',
              deletedAt: '2026-11-01T00:00:00.000Z',
              daysLeft: 1,
            }),
          ],
        },
      },
      'GET /api/instance/settings': { body: settingsFixture() },
      'POST /api/instance/workspaces/w9/purge': { status: 204 },
    })
    await show()
    await expect.element(page.getByText('Deleted · 1 day left')).toBeVisible()
    await page.getByRole('button', { name: 'Delete permanently now' }).click()
    const confirm = page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete permanently' })
    await expect.element(confirm).toBeDisabled()
    await page.getByRole('alertdialog').getByRole('textbox').fill('old-co')
    await confirm.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { status: 403, body: { error: 'Forbidden' } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })

  it('shows an empty state', async () => {
    fakeApi({ 'GET /api/instance/workspaces': { body: { workspaces: [] } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'No workspaces yet' })).toBeVisible()
  })

  it('creates a workspace for an owner, showing the address it gets', async () => {
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/workspaces': {
        status: 201,
        body: { workspace: workspace({ id: 'w3', name: 'Acme Mobile', slug: 'acme-mobile' }) },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create workspace' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await expect.element(page.getByText('Address: acme-mobile')).toBeVisible()
    await page.getByRole('textbox', { name: 'Owner’s email' }).fill('dana@acme.dev')
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('Created the workspace Acme Mobile.')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({ name: 'Acme Mobile', ownerEmail: 'dana@acme.dev' })
  })

  it('checks the fields, and shows the server’s refusal', async () => {
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/workspaces': {
        status: 404,
        body: { error: 'No account has that email' },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create workspace' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Acme Mobile')
    await page.getByRole('textbox', { name: 'Owner’s email' }).fill('nobody@acme.dev')
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()
    await expect.element(page.getByText('No account has that email')).toBeVisible()
  })
})
