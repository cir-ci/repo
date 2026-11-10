import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { IntegrationsPage } from '#features/integrations/IntegrationsPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { CATALOG, item } from './fixtures.ts'

const LIST = '/api/workspaces/acme/integrations'

const list = (over: { canManage?: boolean; integrations?: ReturnType<typeof item>[] } = {}) => ({
  body: {
    canManage: over.canManage ?? true,
    integrations: over.integrations ?? [],
    catalog: CATALOG,
  },
})

const show = () =>
  renderPage(<IntegrationsPage />, {
    route: '/workspaces/$workspace/settings/integrations',
    url: '/workspaces/acme/settings/integrations',
    otherRoutes: ['/workspaces/$workspace/settings/members'],
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
            name: 'Installation 501',
            teamCount: 2,
            needsAttention: true,
            attentionReason: 'installation_revoked',
          }),
          item({ kind: 'slack', id: 's1', group: 'chat', name: 'Acme Slack' }),
        ],
      }),
    })
    await show()
    const git = page.getByRole('region', { name: 'Git hosts' })
    await expect.element(git.getByText('Installation 501 · 2 teams')).toBeVisible()
    await expect.element(git.getByText('Needs attention')).toBeVisible()
    await expect.element(git.getByRole('link', { name: /Configure/ })).toBeVisible()
    const chat = page.getByRole('region', { name: 'Chat' })
    await expect.element(chat.getByText('Acme Slack · No teams yet')).toBeVisible()
    await expect.element(chat.getByText('Connected')).toBeVisible()
    expect(page.getByRole('region', { name: 'Design tools' }).elements()).toHaveLength(0)
    // Providers have a mark, not read aloud.
    expect(document.querySelector('[data-kind="github"] svg')).not.toBeNull()
  })

  it('says so when nothing was added', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${LIST}`]: list() })
    await show()
    await expectEmptyState('No integrations yet', {
      body: 'Add a git host so pull requests show their visual review status.',
    })
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'Integrations' }))
      .toBeVisible()
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
    // One Add button, in the header: the empty state doesn't repeat it.
    expect(page.getByRole('button', { name: 'Add integration' }).elements()).toHaveLength(1)
  })

  it('sends members to Members instead of showing the list', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${LIST}`]: list({
        canManage: false,
        integrations: [item({ kind: 'slack', id: 's1', group: 'chat', name: 'Acme Slack' })],
      }),
    })
    const { router } = await show()
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/members')
    expect(page.getByText('Acme Slack · No teams yet').elements()).toHaveLength(0)
  })

  it('opens the Add dialog from the header', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${LIST}`]: list() })
    await show()
    await page.getByRole('button', { name: 'Add integration' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Add an integration' })).toBeVisible()
  })

  it('opens the same dialog from the empty state', async () => {
    await page.viewport(1000, 800)
    fakeApi({ [`GET ${LIST}`]: list() })
    await show()
    await page.getByRole('button', { name: 'Add integration' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Add an integration' })).toBeVisible()
  })
})

const APP = {
  source: 'manifest',
  canManage: true,
  appId: '1',
  slug: 'circi',
  htmlUrl: 'https://github.com/apps/circi',
  warning: null,
  blocked: null,
  defaultName: 'CirCI (ci.acme.io)',
}

const openAdd = (added: string[] = []) =>
  renderPage(
    <AddIntegrationDialog
      workspace="acme"
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

    // A visible placeholder, and the category tabs on the search's row.
    const search = page.getByRole('searchbox', { name: 'Search integrations' })
    await expect.element(search).toHaveAttribute('placeholder', 'Search integrations')
    const all = page.getByRole('button', { name: 'All', exact: true }).element()
    expect(
      Math.abs(all.getBoundingClientRect().top - search.element().getBoundingClientRect().top),
    ).toBeLessThan(24)

    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('lab')
    await expect.element(tiles.getByRole('listitem')).toHaveLength(1)
    await expect.element(tiles.getByText('GitLab')).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('')
    await page.getByRole('button', { name: 'Chat' }).click()
    await expect.element(tiles.getByRole('listitem')).toHaveLength(2)
    await expect.element(tiles.getByText('Microsoft Teams')).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search integrations' }).fill('zzz')
    await expect.element(page.getByText(/No integration matches/)).toBeVisible()
  })

  it('disables planned tiles, and tiles this server cannot connect', async () => {
    await page.viewport(1000, 800)
    await openAdd()
    await expect.element(page.getByRole('button', { name: 'Add Azure DevOps' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Add Microsoft Teams' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Add Slack' })).toBeDisabled()
    await expect.element(page.getByText('Planned').first()).toBeVisible()
    await expect.element(page.getByText('Coming soon').first()).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add GitHub' })).toBeEnabled()
  })

  it('connects GitHub by installation ID, from the form its definition describes', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'GET /api/instance/github-app': { body: APP },
      'POST /api/workspaces/acme/integrations/github/connect': { status: 201, body: { id: 'c1' } },
    })
    await openAdd()
    await page.getByRole('button', { name: 'Add GitHub' }).click()
    await page.getByRole('button', { name: 'Advanced: connect by installation ID' }).click()
    const field = page.getByRole('textbox', { name: 'GitHub App installation ID' })
    await expect.element(page.getByRole('button', { name: 'Connect GitHub' })).toBeDisabled()
    await field.fill(' 4242 ')
    await page.getByRole('button', { name: 'Connect GitHub' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ installationId: '4242' })
  })
})
