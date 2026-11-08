import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { BitbucketIntegrationPage } from '#features/integrations/BitbucketIntegrationPage.tsx'
import { IntegrationsPage } from '#features/integrations/IntegrationsPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry, item } from './fixtures.ts'

afterEach(() => restoreFetch())

const catalog = [
  entry({ kind: 'github', name: 'GitHub' }),
  entry({ kind: 'bitbucket', name: 'Bitbucket' }),
  entry({ kind: 'gitlab', name: 'GitLab', built: false, connectable: false }),
]

const open = (added: string[] = []) =>
  renderPage(
    <AddIntegrationDialog
      org="acme"
      open
      onOpenChange={() => {}}
      catalog={catalog}
      added={added}
    />,
  )

describe('Add Bitbucket', () => {
  it('connects a workspace with a token, sending only what was typed', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'POST /api/orgs/acme/integrations/bitbucket': { status: 201, body: { id: 'c1' } },
    })
    await open()
    await expect.element(page.getByRole('button', { name: 'Add Bitbucket' })).toBeEnabled()
    await page.getByRole('button', { name: 'Add Bitbucket' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Connect Bitbucket' })).toBeVisible()
    const submit = page.getByRole('button', { name: 'Connect Bitbucket' })
    await expect.element(submit).toBeDisabled()
    await page.getByRole('textbox', { name: 'Bitbucket workspace' }).fill('not valid!')
    await expect
      .element(page.getByText('Use letters, numbers, dashes and underscores'))
      .toBeVisible()
    await page.getByRole('textbox', { name: 'Bitbucket workspace' }).fill(' acme ')
    await expect.element(submit).toBeDisabled()
    await page.getByLabelText('Access token').fill(' tok-123 ')
    await expect.element(submit).toBeEnabled()
    await submit.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ workspace: 'acme', token: 'tok-123' })
  })

  it('sends the username for an app password, and shows the server’s refusal', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'POST /api/orgs/acme/integrations/bitbucket': {
        status: 400,
        body: { error: 'Bitbucket did not accept that token' },
      },
    })
    await open()
    await page.getByRole('button', { name: 'Add Bitbucket' }).click()
    await page.getByRole('textbox', { name: 'Bitbucket workspace' }).fill('acme')
    await page.getByLabelText('Access token').fill('pw')
    await page.getByRole('textbox', { name: /Username/ }).fill('ann')
    await page.getByRole('button', { name: 'Connect Bitbucket' }).click()
    await expect.element(page.getByText('Bitbucket did not accept that token')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({ workspace: 'acme', token: 'pw', username: 'ann' })
  })

  it('the integrations list links a connected workspace to its own page', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'GET /api/orgs/acme/integrations': {
        body: {
          canManage: true,
          integrations: [
            item({ kind: 'bitbucket', id: 'c1', source: 'connection', name: 'acme-ws' }),
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
      .element(page.getByRole('link', { name: 'Configure Bitbucket (acme-ws)' }))
      .toHaveAttribute('href', '/organizations/acme/settings/integrations/bitbucket')
  })
})

const BITBUCKET = '/api/orgs/acme/integrations/bitbucket'
const data = (over: { canManage?: boolean; connections?: number } = {}) => ({
  body: {
    canManage: over.canManage ?? true,
    webhookUrl: 'https://circi.test/webhooks/bitbucket',
    webhookSecret: over.canManage === false ? null : 's3cret-value',
    connections: [
      { id: 'c1', workspace: 'acme', needsAttention: false },
      ...(over.connections === 2 ? [{ id: 'c2', workspace: 'other', needsAttention: false }] : []),
    ],
    projects: [
      { slug: 'web', name: 'Web', repoRef: 'acme/web', connectionId: 'c1' },
      { slug: 'docs', name: 'Docs', repoRef: null, connectionId: null },
    ],
  },
})
const show = () =>
  renderPage(<BitbucketIntegrationPage />, {
    route: '/organizations/$org/settings/integrations/bitbucket',
    url: '/organizations/acme/settings/integrations/bitbucket',
  })

describe('BitbucketIntegrationPage', () => {
  it('shows the webhook address and secret, and maps repositories to projects', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${BITBUCKET}`]: data(),
      'GET /api/orgs/acme/integrations/c1/repositories': {
        body: { repositories: [{ ref: 'acme/docs', private: true }] },
      },
      [`PUT ${BITBUCKET}/projects/docs`]: { body: {} },
      [`DELETE ${BITBUCKET}/projects/web`]: { status: 204 },
    })
    await show()
    await expect.element(page.getByText('https://circi.test/webhooks/bitbucket')).toBeVisible()
    await expect.element(page.getByText('s3cret-value')).toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: 'Web repository' }))
      .toHaveValue('acme/web')
    await page.getByRole('combobox', { name: 'Docs repository' }).fill(' acme/docs ')
    await page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'acme/docs', connectionId: 'c1' })
    await page.getByRole('form', { name: 'Web' }).getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('offers a workspace per project only when there are several, and uses it', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${BITBUCKET}`]: data({ connections: 2 }),
      'GET /api/orgs/acme/integrations/c1/repositories': { body: { repositories: [] } },
      'GET /api/orgs/acme/integrations/c2/repositories': { body: { repositories: [] } },
      [`PUT ${BITBUCKET}/projects/docs`]: { body: {} },
    })
    await show()
    await page.getByRole('combobox', { name: 'Docs workspace' }).click()
    await page.getByRole('option', { name: 'other' }).click()
    await page.getByRole('combobox', { name: 'Docs repository' }).fill('other/site')
    await page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'other/site', connectionId: 'c2' })
  })

  it('is read-only for members, who never see the secret', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${BITBUCKET}`]: data({ canManage: false }) })
    await show()
    await expect.element(page.getByText('acme/web')).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
    expect(page.getByText('s3cret-value').elements()).toHaveLength(0)
  })

  it('points to Integrations when nothing is connected', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${BITBUCKET}`]: { body: { ...data().body, connections: [] } } })
    await show()
    await expect.element(page.getByText('Bitbucket isn’t connected')).toBeVisible()
  })
})
