import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { navigation } from '#features/integrations/slack-api.ts'
import { SlackIntegrationPage } from '#features/integrations/SlackIntegrationPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry } from './fixtures.ts'

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

const SLACK = '/api/orgs/acme/integrations/slack'

const pageData = (over: Record<string, unknown> = {}) => ({
  body: {
    canManage: true,
    configured: true,
    workspaces: [
      { id: 'w1', name: 'Acme Workspace', needsAttention: false, attentionReason: null },
    ],
    projects: [
      {
        slug: 'web',
        name: 'Web',
        integrationId: 'w1',
        channelId: 'C01WEB',
        channelName: 'web-reviews',
        events: ['review_requested', 'build_rejected'],
      },
      {
        slug: 'docs',
        name: 'Docs',
        integrationId: null,
        channelId: null,
        channelName: null,
        events: [],
      },
    ],
    ...over,
  },
})

const CHANNELS = {
  body: {
    channels: [
      { id: 'C01WEB', name: 'web-reviews', private: false },
      { id: 'G01DSGN', name: 'design', private: true },
    ],
  },
}

const show = (url = '/organizations/acme/settings/integrations/slack') =>
  renderPage(<SlackIntegrationPage />, {
    route: '/organizations/$org/settings/integrations/slack',
    url,
  })

describe('SlackIntegrationPage', () => {
  it('maps a project to a channel with the chosen events, and stops sending', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${SLACK}`]: pageData(),
      [`GET ${SLACK}/w1/channels`]: CHANNELS,
      [`PUT ${SLACK}/w1/projects/docs`]: { status: 204 },
      [`DELETE ${SLACK}/w1/projects/web`]: { status: 204 },
    })
    await show()
    const web = page.getByRole('form', { name: 'Web' })
    await expect
      .element(web.getByRole('combobox', { name: 'Web channel' }))
      .toHaveTextContent('#web-reviews')
    await expect.element(web.getByRole('checkbox', { name: 'Review requested' })).toBeChecked()
    await expect.element(web.getByRole('checkbox', { name: 'Review overdue' })).not.toBeChecked()

    const docs = page.getByRole('form', { name: 'Docs' })
    // Nothing saved yet: the defaults are on, approvals are not.
    await expect.element(docs.getByRole('checkbox', { name: 'Build rejected' })).toBeChecked()
    await expect.element(docs.getByRole('checkbox', { name: 'Build approved' })).not.toBeChecked()
    await expect.element(docs.getByRole('button', { name: 'Save' })).toBeDisabled()
    await docs.getByRole('combobox', { name: 'Docs channel' }).click()
    await page.getByRole('option', { name: 'design (private)' }).click()
    await docs.getByRole('checkbox', { name: 'Review overdue' }).click()
    await docs.getByRole('checkbox', { name: 'Build approved' }).click()
    await docs.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({
      channelId: 'G01DSGN',
      channelName: 'design',
      events: ['review_requested', 'build_rejected', 'build_approved'],
    })

    await web.getByRole('button', { name: 'Stop sending' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('shows the channel read-only to members, without asking Slack for channels', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({ [`GET ${SLACK}`]: pageData({ canManage: false }) })
    await show()
    await expect.element(page.getByText('#web-reviews')).toBeVisible()
    await expect.element(page.getByText('Review requested, Build rejected')).toBeVisible()
    await expect.element(page.getByText('Not sending')).toBeVisible()
    expect(page.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)
    await expect.element(page.getByText(/Only owners and admins/)).toBeVisible()
    expect(fake.of('GET').some((r) => r.path.endsWith('/channels'))).toBe(false)
  })

  it('offers Connect Slack when no workspace is connected and starts the install', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      [`GET ${SLACK}`]: pageData({ workspaces: [], projects: [] }),
      [`GET ${SLACK}/install`]: { body: { url: 'https://slack.com/oauth/v2/authorize?state=s' } },
    })
    await show()
    await page.getByRole('button', { name: 'Connect Slack' }).click()
    await expect
      .poll(() => assign.mock.calls)
      .toEqual([['https://slack.com/oauth/v2/authorize?state=s']])
  })

  it('says when the server has no Slack app, and when a workspace needs reinstalling', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${SLACK}`]: pageData({ configured: false, workspaces: [], projects: [] }) })
    await show()
    await expect.element(page.getByText(/SLACK_CLIENT_ID/)).toBeVisible()
    restoreFetch()
    fakeApi({
      [`GET ${SLACK}`]: pageData({
        workspaces: [
          {
            id: 'w1',
            name: 'Acme Workspace',
            needsAttention: true,
            attentionReason: 'token_revoked',
          },
        ],
      }),
      [`GET ${SLACK}/w1/channels`]: {
        status: 409,
        body: { error: 'Slack no longer accepts this workspace' },
      },
    })
    await show()
    await expect.element(page.getByText('CirCI can’t reach Acme Workspace:')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Reinstall Acme Workspace' }))
      .toBeVisible()
  })

  it('reports how the install ended', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${SLACK}`]: pageData(), [`GET ${SLACK}/w1/channels`]: CHANNELS })
    await show('/organizations/acme/settings/integrations/slack?slack=connected')
    await expect.element(page.getByText(/Slack is connected/)).toBeVisible()
  })
})

describe('Add dialog', () => {
  it('starts the Slack install from the Slack tile, and says when it is not set up', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      [`GET ${SLACK}/install`]: { body: { url: 'https://slack.com/oauth/v2/authorize?state=x' } },
    })
    const catalog = [
      entry({ kind: 'slack', name: 'Slack', group: 'chat' }),
      entry({ kind: 'teams', name: 'Microsoft Teams', group: 'chat', connectable: false }),
    ]
    await renderPage(
      <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
    )
    await page.getByRole('button', { name: 'Add Slack' }).click()
    await expect
      .poll(() => assign.mock.calls)
      .toEqual([['https://slack.com/oauth/v2/authorize?state=x']])
  })

  it('disables the Slack tile with the server wording when the app is not configured', async () => {
    await page.viewport(1000, 900)
    const catalog = [entry({ kind: 'slack', name: 'Slack', group: 'chat', connectable: false })]
    await renderPage(
      <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
    )
    await expect.element(page.getByText('Not set up on this server')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add Slack' })).toBeDisabled()
  })
})
