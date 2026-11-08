import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '../../../src/features/integrations/AddIntegrationDialog.tsx'
import { GithubIntegrationPage } from '../../../src/features/integrations/GithubIntegrationPage.tsx'
import { IntegrationsPage } from '../../../src/features/integrations/IntegrationsPage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, restoreFetch } from '../fetch-routes.ts'
import { CATALOG, item } from './fixtures.ts'

afterEach(() => restoreFetch())

const LIST = '/api/orgs/acme/integrations'

const list = (over: { canManage?: boolean; integrations?: ReturnType<typeof item>[] } = {}) => ({
  body: {
    canManage: over.canManage ?? true,
    integrations: over.integrations ?? [],
    catalog: CATALOG,
  },
})

const show = () =>
  renderPage(<IntegrationsPage />, {
    route: '/organizations/$org/settings/integrations',
    url: '/organizations/acme/settings/integrations',
  })

describe('IntegrationsPage', () => {
  it('lists what was added under its group, with logos, counts and attention', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${LIST}`]: list({
        integrations: [
          item({
            kind: 'github',
            id: 'c1',
            source: 'connection',
            name: 'Installation 501',
            projectCount: 2,
            needsAttention: true,
            attentionReason: 'installation_revoked',
          }),
          item({ kind: 'slack', id: 's1', group: 'chat', name: 'Acme Slack' }),
        ],
      }),
    })
    await show()
    const git = page.getByRole('region', { name: 'Git hosts' })
    await expect.element(git.getByText('Installation 501')).toBeVisible()
    await expect.element(git.getByText('2 projects')).toBeVisible()
    await expect.element(git.getByText('Needs attention')).toBeVisible()
    await expect.element(git.getByRole('link', { name: /Configure/ })).toBeVisible()
    const chat = page.getByRole('region', { name: 'Chat' })
    await expect.element(chat.getByText('Acme Slack')).toBeVisible()
    await expect.element(chat.getByText('Connected')).toBeVisible()
    expect(page.getByRole('region', { name: 'Design tools' }).elements()).toHaveLength(0)
    // Providers have a mark, not read aloud.
    expect(document.querySelector('svg[data-kind="github"]')).not.toBeNull()
  })

  it('says so when nothing was added', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${LIST}`]: list() })
    await show()
    await expect.element(page.getByText('No integrations yet')).toBeVisible()
  })

  it('removes an integration after a confirmation', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${LIST}`]: list({
        integrations: [item({ kind: 'slack', id: 's1', group: 'chat', name: 'Acme Slack' })],
      }),
      [`DELETE ${LIST}/s1`]: { status: 204 },
    })
    await show()
    await page.getByRole('button', { name: 'Remove slack Acme Slack' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove Acme Slack?' })
    await expect.element(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(fake.of('DELETE')).toHaveLength(0)
    await page.getByRole('button', { name: 'Remove slack Acme Slack' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('shows members the list without Add or Remove', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${LIST}`]: list({
        canManage: false,
        integrations: [item({ kind: 'slack', id: 's1', group: 'chat', name: 'Acme Slack' })],
      }),
    })
    await show()
    await expect.element(page.getByText('Acme Slack')).toBeVisible()
    await expect.element(page.getByText(/Only owners and admins/)).toBeVisible()
    expect(page.getByRole('button', { name: 'Add integration' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /^Remove/ }).elements()).toHaveLength(0)
  })

  it('opens the Add dialog from the header', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${LIST}`]: list() })
    await show()
    await page.getByRole('button', { name: 'Add integration' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Add an integration' })).toBeVisible()
  })
})

const openAdd = (added: string[] = []) =>
  renderPage(
    <AddIntegrationDialog
      org="acme"
      open
      onOpenChange={() => {}}
      catalog={CATALOG}
      added={added}
    />,
  )

describe('AddIntegrationDialog', () => {
  it('lists every integration, searchable and filterable by group', async () => {
    await page.viewport(1000, 800)
    await openAdd(['github'])
    const tiles = page.getByRole('list', { name: 'Available integrations' })
    await expect.element(tiles.getByRole('listitem')).toHaveLength(CATALOG.length)
    await expect.element(page.getByText('Added')).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('lab')
    await expect.element(tiles.getByRole('listitem')).toHaveLength(1)
    await expect.element(tiles.getByText('GitLab')).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('')
    await page.getByRole('button', { name: 'Chat' }).click()
    await expect.element(tiles.getByRole('listitem')).toHaveLength(2)
    await expect.element(tiles.getByText('Microsoft Teams')).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('zzz')
    await expect.element(page.getByText(/No integrations match/)).toBeVisible()
  })

  it('disables planned tiles, and tiles this server cannot connect', async () => {
    await page.viewport(1000, 800)
    await openAdd()
    await expect.element(page.getByRole('button', { name: 'Add Azure DevOps' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Add Microsoft Teams' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Add Slack' })).toBeDisabled()
    await expect.element(page.getByText('Planned').first()).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add GitHub' })).toBeEnabled()
  })

  it('connects GitHub by installation id', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'POST /api/orgs/acme/integrations/github': { status: 201, body: { id: 'c1' } },
    })
    await openAdd()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    const field = page.getByRole('textbox', { name: 'GitHub App installation id' })
    await field.fill('12a')
    await expect.element(page.getByText('The installation id is a number')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled()
    await field.fill(' 4242 ')
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ installationId: '4242' })
  })
})

const GITHUB = '/api/orgs/acme/integrations/github'
const githubData = (canManage = true) => ({
  body: {
    canManage,
    configured: true,
    webhookUrl: 'https://circi.test/webhooks/github',
    connections: [{ id: 'c1', installationId: '4242', needsAttention: false }],
    projects: [
      { slug: 'web', name: 'Web', repoRef: 'acme/web', installationId: '4242' },
      { slug: 'docs', name: 'Docs', repoRef: null, installationId: null },
    ],
  },
})
const showGithub = () =>
  renderPage(<GithubIntegrationPage />, {
    route: '/organizations/$org/settings/integrations/github',
    url: '/organizations/acme/settings/integrations/github',
  })

describe('GithubIntegrationPage', () => {
  it('maps repositories to projects with the existing project API', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${GITHUB}`]: githubData(),
      'GET /api/orgs/acme/integrations/c1/repositories': {
        body: { repositories: [{ ref: 'acme/docs', private: false }] },
      },
      'PUT /api/projects/acme/docs/github': { body: { link: {} } },
      'DELETE /api/projects/acme/web/github': { status: 204 },
    })
    await showGithub()
    await expect.element(page.getByText('https://circi.test/webhooks/github')).toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: 'Web repository' }))
      .toHaveValue('acme/web')
    await page.getByRole('combobox', { name: 'Docs repository' }).fill(' acme/docs ')
    await page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ repoRef: 'acme/docs', installationId: '4242' })
    await page.getByRole('form', { name: 'Web' }).getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('is read-only for members', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${GITHUB}`]: githubData(false) })
    await showGithub()
    await expect.element(page.getByText('acme/web')).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})
