import type { Issue } from '@circi/api'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { TrackerIntegrationPage } from '#features/integrations/TrackerIntegrationPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { CATALOG, entry } from './fixtures.ts'

afterEach(() => restoreFetch())

const BASE = '/api/orgs/acme/integrations'

const pageBody = (over: Partial<Issue.Page> = {}): Issue.Page => ({
  canManage: true,
  connections: [{ id: 'c1', name: 'Acme Linear', needsAttention: false }],
  projects: [
    { slug: 'web', name: 'web', integrationId: null, target: null, targetName: null },
    { slug: 'api', name: 'api', integrationId: 'c1', target: 't1', targetName: 'Web (WEB)' },
  ],
  ...over,
})

const targets = {
  targets: [
    { ref: 't1', name: 'Web (WEB)' },
    { ref: 't2', name: 'Platform (PLT)' },
  ],
}

const show = (kind: 'linear' | 'jira' = 'linear') =>
  renderPage(<TrackerIntegrationPage kind={kind} org="acme" />, {
    route: `/organizations/$org/settings/integrations/${kind}`,
    url: `/organizations/acme/settings/integrations/${kind}`,
  })

describe('TrackerIntegrationPage', () => {
  it('maps a project to a team and unlinks another', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${BASE}/linear`]: { body: pageBody() },
      [`GET ${BASE}/c1/targets`]: { body: targets },
      [`PUT ${BASE}/c1/projects/web`]: { status: 204 },
      [`DELETE ${BASE}/c1/projects/api`]: { status: 204 },
    })
    await show()
    const web = page.getByRole('group', { name: 'web' })
    await web.getByRole('combobox', { name: 'web team' }).click()
    await page.getByRole('option', { name: 'Platform (PLT)' }).click()
    await web.getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ target: 't2' })

    await page.getByRole('group', { name: 'api' }).getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('says Jira has projects, not teams', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${BASE}/jira`]: {
        body: pageBody({ connections: [{ id: 'c1', name: 's', needsAttention: false }] }),
      },
      [`GET ${BASE}/c1/targets`]: { body: targets },
    })
    await show('jira')
    await expect.element(page.getByRole('combobox', { name: 'web project' })).toBeVisible()
  })

  it('points to Integrations when the tracker is not connected', async () => {
    fakeApi({ [`GET ${BASE}/linear`]: { body: pageBody({ connections: [] }) } })
    await show()
    await expect.element(page.getByText('Linear isn’t connected')).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Add it from Integrations' })).toBeVisible()
  })

  it('shows members the mapping read-only', async () => {
    fakeApi({ [`GET ${BASE}/linear`]: { body: pageBody({ canManage: false }) } })
    await show()
    await expect.element(page.getByText(/Only owners and admins/)).toBeVisible()
    await expect.element(page.getByText('Web (WEB)')).toBeVisible()
    expect(page.getByRole('button', { name: 'Link' }).elements()).toHaveLength(0)
  })

  it('warns when the saved credentials were rejected', async () => {
    fakeApi({
      [`GET ${BASE}/linear`]: {
        body: pageBody({ connections: [{ id: 'c1', name: 'Acme Linear', needsAttention: true }] }),
      },
      [`GET ${BASE}/c1/targets`]: { status: 502, body: { error: 'nope' } },
    })
    await show()
    await expect.element(page.getByText(/saved credentials were rejected/)).toBeVisible()
  })
})

describe('Add dialog: trackers', () => {
  const catalog = [
    ...CATALOG,
    entry({ kind: 'linear', name: 'Linear', group: 'tracker' }),
    entry({ kind: 'jira', name: 'Jira', group: 'tracker' }),
  ]
  const open = () =>
    renderPage(
      <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
    )

  it('connects Linear with an API key', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({ [`POST ${BASE}/linear`]: { status: 201, body: { id: 'c9' } } })
    await open()
    await page.getByRole('button', { name: 'Add Linear' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect Linear' })
    const connect = dialog.getByRole('button', { name: 'Connect Linear' })
    await expect.element(connect).toBeDisabled()
    await dialog.getByLabelText('Linear API key').fill('lin_api_123')
    await connect.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ apiKey: 'lin_api_123' })
  })

  it('connects Jira with the site, email and token, and shows a rejection', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`POST ${BASE}/jira`]: {
        status: 400,
        body: { error: 'Jira did not accept those credentials' },
      },
    })
    await open()
    await page.getByRole('button', { name: 'Add Jira' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect Jira' })
    await dialog.getByLabelText('Jira site').fill('acme.atlassian.net')
    await dialog.getByLabelText('Account email').fill('ann@acme.test')
    await dialog.getByLabelText('API token').fill('tok')
    await dialog.getByRole('button', { name: 'Connect Jira' }).click()
    await expect.element(dialog.getByText('Jira did not accept those credentials')).toBeVisible()
  })
})
