import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { navigation } from '#features/integrations/api/generic.ts'
import { GenericIntegrationPage } from '#features/integrations/GenericIntegrationPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry } from './fixtures.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const BASE = '/api/workspaces/acme/integrations'
const ROUTE = '/workspaces/$workspace/settings/integrations/$kind/$id'

const slackDefinition = entry({
  kind: 'slack',
  name: 'Slack',
  group: 'chat',
  oauth: true,
  mapping: {
    description: 'Choose a channel for each team.',
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
    teams: [
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

const show = (url = '/workspaces/acme/settings/integrations/slack/w1') =>
  renderPage(<GenericIntegrationPage />, { route: ROUTE, url })

describe('GenericIntegrationPage', () => {
  it('maps a team to a target with the chosen events, and removes the mapping', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/w1/teams`]: pageData(),
      [`GET ${BASE}/w1/targets`]: TARGETS,
      [`PUT ${BASE}/w1/teams/docs`]: { status: 204 },
      [`DELETE ${BASE}/w1/teams/web`]: { status: 204 },
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
    // Nothing changed yet: nothing to save.
    expect(docs.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)
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
      mapping: {
        targetLabel: 'Room',
        targetKind: 'text',
        targetPlaceholder: 'room id',
        fields: [{ kind: 'toggle', key: 'threads', label: 'Use threads', default: true }],
      },
    })
    const fake = fakeApi({
      [`GET ${BASE}/t1/teams`]: pageData(
        { definition, teams: [{ slug: 'web', name: 'Web', mapping: null }] },
        { id: 't1', kind: 'tokenchat', name: 'Chat' },
      ),
      [`PUT ${BASE}/t1/teams/web`]: { status: 204 },
    })
    await show('/workspaces/acme/settings/integrations/tokenchat/t1')
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
    const fake = fakeApi({ [`GET ${BASE}/w1/teams`]: pageData({ canManage: false }) })
    await show()
    await expect.element(page.getByText('web-reviews')).toBeVisible()
    await expect.element(page.getByText('Review requested, Build rejected')).toBeVisible()
    await expect.element(page.getByText('Not set up')).toBeVisible()
    expect(page.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)
    await expect.element(page.getByText(/Only owners and admins/)).toBeVisible()
    expect(fake.of('GET').some((r) => r.path.endsWith('/targets'))).toBe(false)
  })

  it('says when the integration needs attention, and reconnects through the provider', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      [`GET ${BASE}/w1/teams`]: pageData(
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
    await expect.element(page.getByText('Needs attention')).toBeVisible()
    await page.getByRole('button', { name: 'Reconnect Acme Workspace' }).click()
    await expect
      .poll(() => assign.mock.calls)
      .toEqual([['https://slack.com/oauth/v2/authorize?state=s']])
  })

  it('removes the integration after a confirmation', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/w1/teams`]: pageData(),
      [`GET ${BASE}/w1/targets`]: TARGETS,
      [`DELETE ${BASE}/w1`]: { status: 204 },
    })
    await show()
    await page.getByRole('button', { name: 'Remove Acme Workspace' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove Acme Workspace?' })
    await expect.element(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(fake.of('DELETE')).toHaveLength(0)
    await page.getByRole('button', { name: 'Remove Acme Workspace' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('has the breadcrumb as its h1, and no Remove or Reconnect for members', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${BASE}/w1/teams`]: pageData({ canManage: false }) })
    await show()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Slack' })).toBeVisible()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect.element(crumbs.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect.element(crumbs.getByRole('link', { name: 'Integrations' })).toBeVisible()
    expect(page.getByRole('button', { name: /^(Remove|Reconnect)/ }).elements()).toHaveLength(0)
  })

  it('reports how the install ended', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${BASE}/w1/teams`]: pageData(), [`GET ${BASE}/w1/targets`]: TARGETS })
    await show('/workspaces/acme/settings/integrations/slack/w1?connect=connected')
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
        workspace="acme"
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
      credentials: [{ name: 'token', label: 'Token', secret: true, optional: false }],
    })
    await renderPage(
      <AddIntegrationDialog
        workspace="acme"
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
      <AddIntegrationDialog
        workspace="acme"
        open
        onOpenChange={() => {}}
        catalog={catalog}
        added={[]}
      />,
    )
    await expect.element(page.getByText('Not set up on this server')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add Slack' })).toBeDisabled()
  })
})

const figmaDefinition = entry({
  kind: 'figma',
  name: 'Figma',
  group: 'design',
  credentials: [{ name: 'token', label: 'Access token', secret: true, optional: false }],
  mapping: {
    description: 'Choose the Figma file each team is designed in.',
    targetLabel: 'File',
    targetKind: 'text',
    targetPlaceholder: 'https://www.figma.com/design/…',
    fields: [],
  },
  links: {
    kind: 'figma-frame',
    label: 'Frame links',
    targetLabel: 'Frame',
    subject: 'pattern',
    autoLink: true,
    fields: [
      { key: 'pattern', label: 'Snapshot name', placeholder: 'checkout/*' },
      { key: 'url', label: 'Frame address', placeholder: 'https://www.figma.com/design/…' },
    ],
  },
})

const figmaPage = (canManage = true) => ({
  body: {
    canManage,
    configured: false,
    integration: {
      id: 'f1',
      kind: 'figma',
      name: 'michael',
      needsAttention: false,
      attentionReason: null,
    },
    definition: figmaDefinition,
    teams: [
      {
        slug: 'web',
        name: 'Web',
        mapping: { ref: 'FileKey12345', name: 'Checkout v3', extra: { name: 'Checkout v3' } },
      },
      { slug: 'docs', name: 'Docs', mapping: null },
    ],
  },
})

const frameLinks = {
  body: {
    links: [
      {
        id: 'l1',
        subject: 'checkout/cart',
        ref: 'FileKey12345:1:2',
        url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
        title: 'Cart',
        source: 'auto',
        createdAt: '2026-11-03T00:00:00.000Z',
      },
      {
        id: 'l2',
        subject: 'home*',
        ref: 'FileKey12345:1:1',
        url: 'https://www.figma.com/design/FileKey12345?node-id=1-1',
        title: null,
        source: 'manual',
        createdAt: '2026-11-03T00:00:00.000Z',
      },
    ],
  },
}

const showFigma = () => show('/workspaces/acme/settings/integrations/figma/f1')

describe('GenericIntegrationPage links (Figma frames)', () => {
  it('maps a team to a file typed as an address, and shows the links with their source', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/f1/teams`]: figmaPage(),
      [`GET ${BASE}/f1/teams/web/links`]: frameLinks,
      [`GET ${BASE}/f1/teams/docs/links`]: { body: { links: [] } },
      [`PUT ${BASE}/f1/teams/docs`]: { status: 204 },
    })
    await showFigma()
    await expect
      .element(page.getByRole('textbox', { name: 'Web file' }))
      .toHaveValue('FileKey12345')
    const table = page.getByRole('table', { name: 'Web frame links' })
    await expect
      .element(table.getByRole('link', { name: 'Cart' }))
      .toHaveAttribute('href', 'https://www.figma.com/design/FileKey12345?node-id=1-2')
    await expect.element(table.getByText('Auto')).toBeVisible()
    await expect.element(table.getByText('Manual')).toBeVisible()

    await page
      .getByRole('textbox', { name: 'Docs file' })
      .fill('https://www.figma.com/design/KEY123456789/X')
    await page.getByRole('form', { name: 'Docs' }).getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(() => expect(fake.of('PUT')).toHaveLength(1))
    expect(fake.of('PUT')[0]?.body).toEqual({
      ref: 'https://www.figma.com/design/KEY123456789/X',
      extra: {},
    })
  })

  it('adds a link from the definition’s fields, removes one, and links automatically', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/f1/teams`]: figmaPage(),
      [`GET ${BASE}/f1/teams/web/links`]: frameLinks,
      [`GET ${BASE}/f1/teams/docs/links`]: { body: { links: [] } },
      [`POST ${BASE}/f1/teams/web/links`]: { status: 201, body: frameLinks.body.links[0] },
      [`DELETE ${BASE}/f1/teams/web/links/l2`]: { status: 204 },
      [`POST ${BASE}/f1/teams/web/links/auto`]: { body: { created: 2, unlinked: 1, frames: 5 } },
    })
    await showFigma()
    const add = page.getByRole('form', { name: 'Add a link to Web' })
    const submit = add.getByRole('button', { name: 'Add link' })
    await expect.element(submit).toBeDisabled()
    await add.getByRole('textbox', { name: 'Web snapshot name' }).fill(' cart ')
    await add
      .getByRole('textbox', { name: 'Web frame address' })
      .fill('https://www.figma.com/design/K/x?node-id=1-2')
    await expect.element(submit).toBeEnabled()
    await submit.click()
    await vi.waitFor(() => expect(fake.of('POST')).toHaveLength(1))
    expect(fake.of('POST')[0]?.body).toEqual({
      values: { pattern: 'cart', url: 'https://www.figma.com/design/K/x?node-id=1-2' },
    })

    await page.getByRole('button', { name: 'Remove link home*' }).click()
    await vi.waitFor(() => expect(fake.of('DELETE')).toHaveLength(1))

    await page.getByRole('button', { name: 'Link Web automatically' }).click()
    await expect
      .element(
        page.getByText(
          'Linked 2 snapshots to frames; 1 snapshot has no frame with a matching name.',
        ),
      )
      .toBeVisible()
  })

  it('shows members the links without the forms or buttons', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      [`GET ${BASE}/f1/teams`]: figmaPage(false),
      [`GET ${BASE}/f1/teams/web/links`]: frameLinks,
    })
    await showFigma()
    await expect
      .element(
        page.getByRole('table', { name: 'Web frame links' }).getByRole('link', { name: 'Cart' }),
      )
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Link Web automatically' }).query()).toBeNull()
    expect(page.getByRole('form', { name: 'Add a link to Web' }).query()).toBeNull()
    expect(page.getByRole('button', { name: /Remove link/ }).query()).toBeNull()
  })
})

const gitDefinition = entry({
  kind: 'gitlab',
  name: 'GitLab',
  mapping: {
    description: 'Choose the GitLab project each CirCI team reports to.',
    targetLabel: 'GitLab project',
    targetKind: 'repository',
    targetPlaceholder: 'acme/web',
    fields: [],
  },
})

const gitPage = (over: Record<string, unknown> = {}) => ({
  body: {
    canManage: true,
    configured: false,
    integration: {
      id: 'g1',
      kind: 'gitlab',
      name: 'gitlab.example.com#7',
      needsAttention: false,
      attentionReason: null,
    },
    definition: gitDefinition,
    webhook: { url: 'https://circi.test/webhooks/gitlab', secret: 'shh-secret' },
    teams: [
      { slug: 'web', name: 'Web', mapping: { ref: 'acme/web', name: 'acme/web', extra: {} } },
      { slug: 'docs', name: 'Docs', mapping: null },
    ],
    ...over,
  },
})

describe('GenericIntegrationPage for a git host', () => {
  it('shows the webhook address and secret, and maps a repository typed or suggested', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${BASE}/g1/teams`]: gitPage(),
      [`GET ${BASE}/g1/targets`]: {
        body: { targets: [{ id: 'acme/docs', name: 'acme/docs' }] },
      },
      [`PUT ${BASE}/g1/teams/docs`]: { status: 204 },
      [`DELETE ${BASE}/g1/teams/web`]: { status: 204 },
    })
    await show('/workspaces/acme/settings/integrations/gitlab/g1')
    await expect.element(page.getByText('https://circi.test/webhooks/gitlab')).toBeVisible()
    await expect.element(page.getByText('shh-secret')).toBeVisible()
    // Repository first, with its team; the host's own list adds the ones no team has yet.
    await expect
      .element(page.getByRole('combobox', { name: 'Team for acme/web' }))
      .toHaveTextContent('Web')
    await expect
      .element(page.getByRole('combobox', { name: 'Team for acme/docs' }))
      .toHaveTextContent('Not linked')

    await page.getByRole('combobox', { name: 'Team for acme/docs' }).click()
    await page.getByRole('option', { name: 'Docs' }).click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({ ref: 'acme/docs', extra: {} })

    // "Not linked" lets the team go.
    await page.getByRole('combobox', { name: 'Team for acme/web' }).click()
    await page.getByRole('option', { name: 'Not linked' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('flags a repository the host no longer lists, and reinstalls', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      [`GET ${BASE}/g1/teams`]: gitPage(),
      [`GET ${BASE}/g1/targets`]: { body: { targets: [{ id: 'acme/docs', name: 'acme/docs' }] } },
    })
    await show('/workspaces/acme/settings/integrations/gitlab/g1')
    await expect
      .element(page.getByText(/Needs attention: the app was uninstalled from this/))
      .toBeVisible()
  })

  it('is read-only for members, who do not get the webhook secret', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      [`GET ${BASE}/g1/teams`]: gitPage({
        canManage: false,
        webhook: { url: 'https://circi.test/webhooks/gitlab', secret: null },
      }),
    })
    await show('/workspaces/acme/settings/integrations/gitlab/g1')
    await expect.element(page.getByText('https://circi.test/webhooks/gitlab')).toBeVisible()
    expect(page.getByText('shh-secret').elements()).toHaveLength(0)
    await expect.element(page.getByText('acme/web')).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})
