import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WebhooksPage } from '#features/team-settings/WebhooksPage.tsx'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/teams/acme/web'

const hook = (id: string, url: string, events = ['build.completed']) => ({
  id,
  url,
  events,
  enabled: true,
  createdAt: new Date().toISOString(),
  deliveries: [] as Record<string, unknown>[],
})

function api(over: Record<string, unknown> = {}, extra: Record<string, ReplyHandler> = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: {
      body: {
        canManage: true,
        settings: { name: 'Web App' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [],
        webhookEvents: ['build.completed', 'build.reviewed'],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
        ...over,
      },
    },
    ...extra,
  })
}

const show = () =>
  renderPage(<WebhooksPage />, {
    route: '/$workspace/$team/settings/webhooks',
    url: '/acme/web/settings/webhooks',
    announcer: true,
  })
const openDialog = () => page.getByRole('button', { name: 'Add webhook' }).click()
const dialogAdd = () => page.getByRole('dialog').getByRole('button', { name: 'Add webhook' })

describe('WebhooksPage', () => {
  it('sends a test event and lists recent deliveries', async () => {
    const withDeliveries = {
      ...hook('h1', 'https://a.test/hook'),
      deliveries: [
        {
          deliveryId: 'd2',
          event: 'webhook.test',
          test: true,
          attempt: 1,
          statusCode: 200,
          error: null,
          createdAt: new Date().toISOString(),
        },
        {
          deliveryId: 'd1',
          event: 'build.completed',
          test: false,
          attempt: 3,
          statusCode: null,
          error: 'connect ECONNREFUSED',
          createdAt: new Date().toISOString(),
        },
      ],
    }
    const fake = api(
      { webhooks: [withDeliveries] },
      { [`POST ${API}/webhooks/h1/test`]: { status: 202, body: { deliveryId: 'x' } } },
    )
    await show()
    await page.getByText('Recent deliveries (2)').click()
    const list = page.getByRole('list', { name: 'Recent deliveries to https://a.test/hook' })
    await expect.element(list.getByText('200 delivered, test')).toBeVisible()
    await expect.element(list.getByText('connect ECONNREFUSED failed, attempt 3')).toBeVisible()
    await page.getByRole('button', { name: 'Send test to https://a.test/hook' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect.element(page.getByText('Test event queued')).toBeInTheDocument()
  })

  it('says when there are none, and explains how to check a delivery', async () => {
    api()
    await show()
    await expect.element(page.getByText('No webhooks yet')).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Checking a delivery' })).toBeVisible()
    expect(document.title).toBe('Webhooks · web · CirCI')
  })

  it('lists each webhook with its address, events and age', async () => {
    api({
      webhooks: [
        hook('h1', 'https://a.test/hook', ['build.completed', 'build.reviewed']),
        hook('h2', 'https://b.test/hook'),
      ],
    })
    await show()
    const rows = page.getByRole('list', { name: 'Webhooks' })
    await expect.element(rows.getByText('https://a.test/hook')).toBeVisible()
    await expect.element(rows.getByText('https://b.test/hook')).toBeVisible()
    await expect
      .element(rows.getByRole('list', { name: 'Events' }).first().getByText('build.reviewed'))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Remove' }).elements()).toHaveLength(2)
  })

  it('adds one for the picked events and shows its signing secret once', async () => {
    const fake = api(
      {},
      {
        [`POST ${API}/webhooks`]: {
          body: { webhook: hook('h9', 'https://new.test/hook'), secret: 'whsec_abc' },
        },
      },
    )
    await show()
    await openDialog()
    await page.getByRole('textbox', { name: 'Address' }).fill(' https://new.test/hook ')
    await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
    await dialogAdd().click()
    await expect.element(page.getByRole('dialog', { name: 'Signing secret' })).toBeVisible()
    await expect.element(page.getByText('whsec_abc')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Copy/ })).toBeVisible()
    expect(fake.of('POST')).toEqual([
      {
        method: 'POST',
        path: `${API}/webhooks`,
        body: { url: 'https://new.test/hook', events: ['build.completed'] },
      },
    ])
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByText('whsec_abc')).not.toBeInTheDocument()
  })

  it('asks for an address', async () => {
    const fake = api()
    await show()
    await openDialog()
    await dialogAdd().click()
    await expect.element(page.getByText('Enter an address')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
  })

  it('won’t add without an event: says so next to the events, and sends nothing', async () => {
    const fake = api()
    await show()
    await openDialog()
    await page.getByRole('textbox', { name: 'Address' }).fill('https://new.test/hook')
    await page.getByRole('checkbox', { name: 'build.completed' }).click()
    await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
    await dialogAdd().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Choose at least one event')
    expect(fake.of('POST')).toHaveLength(0)
    fake.set(`POST ${API}/webhooks`, {
      body: { webhook: hook('h9', 'https://new.test/hook'), secret: 'whsec_abc' },
    })
    await page.getByRole('checkbox', { name: 'build.reviewed' }).click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await dialogAdd().click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      url: 'https://new.test/hook',
      events: ['build.reviewed'],
    })
  })

  it('shows the server’s refusal of an address', async () => {
    api(
      {},
      { [`POST ${API}/webhooks`]: { status: 400, body: { error: 'Address must be public' } } },
    )
    await show()
    await openDialog()
    await page.getByRole('textbox', { name: 'Address' }).fill('http://localhost/x')
    await dialogAdd().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Address must be public')
  })

  it('removes one only after confirming, naming it', async () => {
    const fake = api(
      { webhooks: [hook('h1', 'https://a.test/hook'), hook('h2', 'https://b.test/hook')] },
      { [`DELETE ${API}/webhooks/h2`]: { status: 204 } },
    )
    await show()
    await page.getByRole('button', { name: 'Remove' }).nth(1).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove webhook?' })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(/https:\/\/b\.test\/hook stops receiving build events/)
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(fake.of('DELETE')).toHaveLength(0)
    await page.getByRole('button', { name: 'Remove' }).nth(1).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
    await expect
      .element(page.getByRole('status').filter({ hasText: /^Webhook removed$/ }))
      .toBeVisible()
  })

  it('lets members look but not add or remove', async () => {
    api({ canManage: false, webhooks: [hook('h1', 'https://a.test/hook')] })
    await show()
    await expect
      .element(page.getByText('Only owners and admins can change these settings.'))
      .toBeVisible()
    await expect.element(page.getByText('https://a.test/hook')).toBeVisible()
    expect(page.getByRole('button', { name: 'Add webhook' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Remove' }).elements()).toHaveLength(0)
  })
})
