import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { navigation } from '#features/integrations/generic-api.ts'
import { GenericIntegrationPage } from '#features/integrations/GenericIntegrationPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry } from './fixtures.ts'

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

const BASE = '/api/orgs/acme/integrations'
const ROUTE = '/organizations/$org/settings/integrations/$kind/$id'

const slackDefinition = entry({
  kind: 'slack',
  name: 'Slack',
  group: 'chat',
  pageStyle: 'generic',
  oauth: true,
  mapping: {
    description: 'Choose a channel for each project.',
    targetLabel: 'Channel',
    targetKind: 'select',
    fields: [
      {
        kind: 'events',
        key: 'events',
        label: 'Events',
        options: [
          { event: 'review.requested', label: 'Review requested' },
          { event: 'review.overdue', label: 'Review overdue' },
          { event: 'build.rejected', label: 'Build rejected' },
          { event: 'build.approved', label: 'Build approved' },
        ],
        defaults: ['review.requested', 'review.overdue', 'build.rejected'],
      },
    ],
  },
})

const pageData = (
  over: Record<string, unknown> = {},
  integration: Record<string, unknown> = {},
) => ({
  body: {
    canManage: true,
    configured: true,
    integration: {
      id: 'w1',
      kind: 'slack',
      name: 'Acme Workspace',
      needsAttention: false,
      attentionReason: null,
      ...integration,
    },
    definition: slackDefinition,
    projects: [
      {
        slug: 'web',
        name: 'Web',
        mapping: {
          ref: 'C01WEB',
          name: 'web-reviews',
          extra: { name: 'web-reviews', events: ['review.requested', 'build.rejected'] },
        },
      },
      { slug: 'docs', name: 'Docs', mapping: null },
    ],
    ...over,
  },
})

const TARGETS = {
  body: {
    targets: [
      { id: 'C01WEB', name: 'web-reviews', label: '#web-reviews' },
      { id: 'G01DSGN', name: 'design', label: 'design (private)' },
    ],
  },
}

const show = (url = '/organizations/acme/settings/integrations/slack/w1') =>
  renderPage(<GenericIntegrationPage />, { route: ROUTE, url })

describe('GenericIntegrationPage', () => {
  it('maps a project to a target with the chosen events, and removes the mapping', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/w1/projects`]: pageData(),
      [`GET ${BASE}/w1/targets`]: TARGETS,
      [`PUT ${BASE}/w1/projects/docs`]: { status: 204 },
      [`DELETE ${BASE}/w1/projects/web`]: { status: 204 },
    })
    await show()
    const web = page.getByRole('form', { name: 'Web' })
    await expect
      .element(web.getByRole('combobox', { name: 'Web channel' }))
      .toHaveTextContent('#web-reviews')
    await expect.element(web.getByRole('checkbox', { name: 'Review requested' })).toBeChecked()
    await expect.element(web.getByRole('checkbox', { name: 'Review overdue' })).not.toBeChecked()

    const docs = page.getByRole('form', { name: 'Docs' })
    // Nothing saved yet: the definition's defaults are on, approvals are not.
    await expect.element(docs.getByRole('checkbox', { name: 'Build rejected' })).toBeChecked()
    await expect.element(docs.getByRole('checkbox', { name: 'Build approved' })).not.toBeChecked()
    await expect.element(docs.getByRole('button', { name: 'Save' })).toBeDisabled()
    await docs.getByRole('combobox', { name: 'Docs channel' }).click()
    await page.getByRole('option', { name: 'design (private)' }).click()
    await docs.getByRole('checkbox', { name: 'Build approved' }).click()
    await docs.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({
      ref: 'G01DSGN',
      name: 'design',
      extra: { events: ['review.requested', 'review.overdue', 'build.rejected', 'build.approved'] },
    })

    await web.getByRole('button', { name: 'Remove Web channel' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('renders a text target as a field and sends what was typed', async () => {
    await page.viewport(1000, 900)
    const definition = entry({
      kind: 'tokenchat',
      name: 'Token chat',
      group: 'chat',
      pageStyle: 'generic',
      mapping: {
        targetLabel: 'Room',
        targetKind: 'text',
        targetPlaceholder: 'room id',
        fields: [{ kind: 'toggle', key: 'threads', label: 'Use threads', default: true }],
      },
    })
    const fake = fakeApi({
      [`GET ${BASE}/t1/projects`]: pageData(
        { definition, projects: [{ slug: 'web', name: 'Web', mapping: null }] },
        { id: 't1', kind: 'tokenchat', name: 'Chat' },
      ),
      [`PUT ${BASE}/t1/projects/web`]: { status: 204 },
    })
    await show('/organizations/acme/settings/integrations/tokenchat/t1')
    const web = page.getByRole('form', { name: 'Web' })
    await web.getByRole('textbox', { name: 'Web room' }).fill('room-9')
    await expect.element(web.getByRole('checkbox', { name: 'Use threads' })).toBeChecked()
    await web.getByRole('checkbox', { name: 'Use threads' }).click()
    await web.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ ref: 'room-9', extra: { threads: false } })
    expect(fake.of('GET').some((r) => r.path.endsWith('/targets'))).toBe(false)
  })

  it('shows the mapping read-only to members, without asking for targets', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({ [`GET ${BASE}/w1/projects`]: pageData({ canManage: false }) })
    await show()
    await expect.element(page.getByText('web-reviews')).toBeVisible()
    await expect.element(page.getByText('Review requested, Build rejected')).toBeVisible()
    await expect.element(page.getByText('Not set up')).toBeVisible()
    expect(page.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)
    await expect.element(page.getByText(/Only owners and admins/)).toBeVisible()
    expect(fake.of('GET').some((r) => r.path.endsWith('/targets'))).toBe(false)
  })

  it('says when the integration needs attention, and reinstalls through the provider', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      [`GET ${BASE}/w1/projects`]: pageData(
        {},
        { needsAttention: true, attentionReason: 'Slack rejected the token (token_revoked)' },
      ),
      [`GET ${BASE}/w1/targets`]: {
        status: 409,
        body: { error: 'Slack no longer accepts this connection' },
      },
      [`GET ${BASE}/slack/install`]: {
        body: { url: 'https://slack.com/oauth/v2/authorize?state=s' },
      },
    })
    await show()
    await expect.element(page.getByText('CirCI can’t reach Acme Workspace:')).toBeVisible()
    await expect.element(page.getByText(/token_revoked/)).toBeVisible()
    await page.getByRole('button', { name: 'Reinstall Acme Workspace' }).click()
    await expect
      .poll(() => assign.mock.calls)
      .toEqual([['https://slack.com/oauth/v2/authorize?state=s']])
  })

  it('reports how the install ended', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${BASE}/w1/projects`]: pageData(), [`GET ${BASE}/w1/targets`]: TARGETS })
    await show('/organizations/acme/settings/integrations/slack/w1?connect=connected')
    await expect.element(page.getByText(/Slack is connected/)).toBeVisible()
  })
})

describe('Add dialog', () => {
  it('starts the install straight from a generic OAuth-only tile', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      [`GET ${BASE}/slack/install`]: {
        body: { url: 'https://slack.com/oauth/v2/authorize?state=x' },
      },
    })
    await renderPage(
      <AddIntegrationDialog
        org="acme"
        open
        onOpenChange={() => {}}
        catalog={[slackDefinition]}
        added={[]}
      />,
    )
    await page.getByRole('button', { name: 'Add Slack' }).click()
    await expect
      .poll(() => assign.mock.calls)
      .toEqual([['https://slack.com/oauth/v2/authorize?state=x']])
  })

  it('opens the connect form for a tile that has credential fields', async () => {
    await page.viewport(1000, 900)
    const tokenchat = entry({
      kind: 'tokenchat',
      name: 'Token chat',
      group: 'chat',
      pageStyle: 'generic',
      credentials: [{ name: 'token', label: 'Token', secret: true, optional: false }],
    })
    await renderPage(
      <AddIntegrationDialog
        org="acme"
        open
        onOpenChange={() => {}}
        catalog={[tokenchat]}
        added={[]}
      />,
    )
    await page.getByRole('button', { name: 'Add Token chat' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Connect Token chat' })).toBeVisible()
    await expect.element(page.getByLabelText('Token')).toBeVisible()
  })

  it('disables a generic tile the server says it cannot connect', async () => {
    await page.viewport(1000, 900)
    const catalog = [{ ...slackDefinition, connectable: false }]
    await renderPage(
      <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
    )
    await expect.element(page.getByText('Not set up on this server')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add Slack' })).toBeDisabled()
  })
})
