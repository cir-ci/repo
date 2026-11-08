import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { GitlabIntegrationPage } from '#features/integrations/GitlabIntegrationPage.tsx'
import { IntegrationsPage } from '#features/integrations/IntegrationsPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry, item } from './fixtures.ts'

afterEach(() => restoreFetch())

const catalog = [
  entry({ kind: 'github', name: 'GitHub' }),
  entry({ kind: 'gitlab', name: 'GitLab' }),
]

const open = () =>
  renderPage(
    <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
  )

describe('Add GitLab', () => {
  it('connects with an address and a token, sending trimmed values', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'POST /api/orgs/acme/integrations/gitlab': { status: 201, body: { id: 'c1' } },
    })
    await open()
    await page.getByRole('button', { name: 'Add GitLab' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Connect GitLab' })).toBeVisible()
    const submit = page.getByRole('button', { name: 'Connect GitLab' })
    await expect.element(submit).toBeDisabled()
    await page.getByRole('textbox', { name: 'GitLab address' }).fill('gitlab')
    await expect
      .element(page.getByText('Enter a full address such as https://gitlab.com'))
      .toBeVisible()
    await page.getByRole('textbox', { name: 'GitLab address' }).fill(' https://git.acme.io ')
    await expect.element(submit).toBeDisabled()
    await page.getByLabelText('Access token').fill(' glpat-1 ')
    await expect.element(submit).toBeEnabled()
    await submit.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ baseUrl: 'https://git.acme.io', token: 'glpat-1' })
  })

  it('defaults to gitlab.com and shows the server’s refusal', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'POST /api/orgs/acme/integrations/gitlab': {
        status: 400,
        body: { error: 'GitLab did not accept that token' },
      },
    })
    await open()
    await page.getByRole('button', { name: 'Add GitLab' }).click()
    await expect
      .element(page.getByRole('textbox', { name: 'GitLab address' }))
      .toHaveValue('https://gitlab.com')
    await page.getByLabelText('Access token').fill('bad')
    await page.getByRole('button', { name: 'Connect GitLab' }).click()
    await expect.element(page.getByText('GitLab did not accept that token')).toBeVisible()
  })

  it('the integrations list links a connection to its own page', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'GET /api/orgs/acme/integrations': {
        body: {
          canManage: true,
          integrations: [
            item({ kind: 'gitlab', id: 'c1', source: 'connection', name: 'gitlab.com#7' }),
          ],
          catalog,
        },
      },
    })
    await renderPage(<IntegrationsPage />, {
      route: '/organizations/$org/settings/integrations',
      url: '/organizations/acme/settings/integrations',
    })
    await expect
      .element(page.getByRole('link', { name: 'Configure GitLab (gitlab.com#7)' }))
      .toHaveAttribute('href', '/organizations/acme/settings/integrations/gitlab')
  })
})

const GITLAB = '/api/orgs/acme/integrations/gitlab'
const data = (over: { canManage?: boolean; connections?: number } = {}) => ({
  body: {
    canManage: over.canManage ?? true,
    webhookUrl: 'https://circi.test/webhooks/gitlab',
    webhookSecret: over.canManage === false ? null : 's3cret-value',
    connections: [
      { id: 'c1', name: 'gitlab.com#7', needsAttention: false },
      ...(over.connections === 2
        ? [{ id: 'c2', name: 'git.acme.io#8', needsAttention: false }]
        : []),
    ],
    projects: [
      { slug: 'web', name: 'Web', repoRef: 'acme/tools/web', connectionId: 'c1' },
      { slug: 'docs', name: 'Docs', repoRef: null, connectionId: null },
    ],
  },
})
const show = () =>
  renderPage(<GitlabIntegrationPage />, {
    route: '/organizations/$org/settings/integrations/gitlab',
    url: '/organizations/acme/settings/integrations/gitlab',
  })

describe('GitlabIntegrationPage', () => {
  it('shows the webhook address and secret, and maps GitLab project paths to projects', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${GITLAB}`]: data(),
      'GET /api/orgs/acme/integrations/c1/repositories': {
        body: { repositories: [{ ref: 'acme/docs', private: true }] },
      },
      [`PUT ${GITLAB}/projects/docs`]: { body: {} },
      [`DELETE ${GITLAB}/projects/web`]: { status: 204 },
    })
    await show()
    await expect.element(page.getByText('https://circi.test/webhooks/gitlab')).toBeVisible()
    await expect.element(page.getByText('s3cret-value')).toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: 'Web GitLab project' }))
      .toHaveValue('acme/tools/web')
    const link = page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Link' })
    await page.getByRole('combobox', { name: 'Docs GitLab project' }).fill('docs')
    await expect
      .element(page.getByText('Use the project path with its namespace, e.g. acme/web'))
      .toBeVisible()
    await expect.element(link).toBeDisabled()
    await page.getByRole('combobox', { name: 'Docs GitLab project' }).fill(' acme/docs ')
    await link.click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'acme/docs', connectionId: 'c1' })
    await page.getByRole('form', { name: 'Web' }).getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('offers a GitLab account per project only when there are several, and uses it', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${GITLAB}`]: data({ connections: 2 }),
      'GET /api/orgs/acme/integrations/c1/repositories': { body: { repositories: [] } },
      'GET /api/orgs/acme/integrations/c2/repositories': { body: { repositories: [] } },
      [`PUT ${GITLAB}/projects/docs`]: { body: {} },
    })
    await show()
    await page.getByRole('combobox', { name: 'Docs GitLab account' }).click()
    await page.getByRole('option', { name: 'git.acme.io#8' }).click()
    await page.getByRole('combobox', { name: 'Docs GitLab project' }).fill('grp/site')
    await page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'grp/site', connectionId: 'c2' })
  })

  it('is read-only for members, who never see the secret', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${GITLAB}`]: data({ canManage: false }) })
    await show()
    await expect.element(page.getByText('acme/tools/web')).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
    expect(page.getByText('s3cret-value').elements()).toHaveLength(0)
  })

  it('points to Integrations when nothing is connected', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${GITLAB}`]: { body: { ...data().body, connections: [] } } })
    await show()
    await expect.element(page.getByText('GitLab isn’t connected')).toBeVisible()
  })
})
