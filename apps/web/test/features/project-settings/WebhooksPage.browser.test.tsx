import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WebhooksPage } from '#features/project-settings/WebhooksPage.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { pageHeader } from '#test/support/header.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

const API = '/api/projects/acme/web'

const at = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString()

const hook = (id: string, url: string, events = ['build.completed']) => ({
  id,
  url,
  events,
  enabled: true,
  createdAt: new Date().toISOString(),
  deliveries: [] as Record<string, unknown>[],
})

const delivery = (id: string, statusCode: number) => ({
  deliveryId: id,
  event: 'build.completed',
  test: false,
  attempt: 1,
  statusCode,
  error: null,
  createdAt: at(60_000),
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
    route: '/$workspace/$project/settings/webhooks',
    url: '/acme/web/settings/webhooks',
    announcer: true,
    otherRoutes: ['/$workspace/$project', '/$workspace/$project/settings'],
  })
// Add webhook is the page header's button; the empty state has none of its own.
const openDialog = () => page.getByRole('button', { name: 'Add webhook' }).click()
const dialogAdd = () => page.getByRole('dialog').getByRole('button', { name: 'Add webhook' })

describe('WebhooksPage', () => {
  it('has Add webhook once, in the page header, even with no webhooks', async () => {
    api()
    await show()
    const add = page.getByRole('button', { name: 'Add webhook' })
    await expect.element(add).toBeVisible()
    expect(add.elements()).toHaveLength(1)
    expect(pageHeader().contains(add.element())).toBe(true)
  })

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
    const table = page.getByRole('table', { name: 'Deliveries to https://a.test/hook' })
    await expect.element(table.getByText('200', { exact: true })).toBeVisible()
    await expect.element(table.getByText('connect ECONNREFUSED')).toBeVisible()
    await expect.element(table.getByText('3 of 8')).toBeVisible()
    await expect.element(table.getByText('webhook.test (test)')).toBeVisible()
    await page.getByRole('button', { name: 'Send test to https://a.test/hook' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect.element(page.getByText('Test event queued')).toBeInTheDocument()
  })

  it('says the test was sent, then polls until its delivery shows up', async () => {
    const fake = api(
      { webhooks: [hook('h1', 'https://a.test/hook')] },
      { [`POST ${API}/webhooks/h1/test`]: { status: 202, body: { deliveryId: 'dx' } } },
    )
    await show()
    await page.getByRole('button', { name: 'Send test to https://a.test/hook' }).click()
    await expect.element(page.getByText(/Test sent to https:\/\/a\.test\/hook/)).toBeVisible()
    // The worker delivers a moment later: the next poll picks it up, no reload.
    fake.set(`GET ${API}/settings`, {
      body: {
        canManage: true,
        settings: { name: 'Web App' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [
          {
            ...hook('h1', 'https://a.test/hook'),
            deliveries: [
              {
                deliveryId: 'dx',
                event: 'webhook.test',
                test: true,
                attempt: 1,
                statusCode: 200,
                error: null,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
        webhookEvents: ['build.completed', 'build.reviewed'],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
      },
    })
    const table = page.getByRole('table', { name: 'Deliveries to https://a.test/hook' })
    await expect.element(table.getByText('webhook.test (test)'), { timeout: 5000 }).toBeVisible()
    await expect.element(page.getByText(/Test delivered/)).toBeVisible()
  })

  it('says "Test failed" with the reason when the delivery got no answer', async () => {
    const fake = api(
      { webhooks: [hook('h1', 'https://a.test/hook')] },
      { [`POST ${API}/webhooks/h1/test`]: { status: 202, body: { deliveryId: 'dx' } } },
    )
    await show()
    await page.getByRole('button', { name: 'Send test to https://a.test/hook' }).click()
    await expect.element(page.getByText(/Test sent to/)).toBeVisible()
    fake.set(`GET ${API}/settings`, {
      body: {
        canManage: true,
        settings: { name: 'Web App' },
        appearance: { color: 'slate', icon: null },
        workspace: { flakyBlocksMerge: true },
        webhooks: [
          {
            ...hook('h1', 'https://a.test/hook'),
            deliveries: [
              {
                deliveryId: 'dx',
                event: 'webhook.test',
                test: true,
                attempt: 1,
                statusCode: null,
                error: 'fetch failed',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
        webhookEvents: ['build.completed', 'build.reviewed'],
        github: { configured: false, webhookUrl: '', link: null },
        sitesConfigured: false,
      },
    })
    await expect
      .element(page.getByText('Test failed: fetch failed'), { timeout: 5000 })
      .toBeVisible()
    expect(page.getByText(/Test delivered/).elements()).toHaveLength(0)
    expect(page.getByText(/Test sent to/).elements()).toHaveLength(0)
  })

  it('shows each webhook as a row with event tags and a delivery badge', async () => {
    const failing = {
      ...hook('h2', 'https://deploy.test/gate', ['build.reviewed']),
      deliveries: [
        {
          deliveryId: 'd9',
          event: 'build.reviewed',
          test: false,
          attempt: 3,
          statusCode: 502,
          error: null,
          createdAt: at(60_000),
        },
        {
          deliveryId: 'd9',
          event: 'build.reviewed',
          test: false,
          attempt: 1,
          statusCode: null,
          error: 'Timed out',
          createdAt: at(600_000),
        },
      ],
    }
    const delivered = {
      ...hook('h1', 'https://a.test/hook', ['build.completed', 'build.reviewed']),
      deliveries: [
        {
          deliveryId: 'd1',
          event: 'build.completed',
          test: false,
          attempt: 1,
          statusCode: 200,
          error: null,
          createdAt: at(120_000),
        },
      ],
    }
    api({ webhooks: [delivered, failing, hook('h3', 'https://quiet.test/x')] })
    await show()
    const rows = page.getByRole('list', { name: 'Webhooks' })
    await expect.element(rows.getByText('Delivered 2 minutes ago')).toBeVisible()
    await expect.element(rows.getByText('Failing: 502, retrying 3/8')).toBeVisible()
    await expect.element(rows.getByText('No deliveries yet')).toBeVisible()
    // The recent deliveries have their own section, headed by the address; none for a quiet hook.
    await expect
      .element(page.getByRole('heading', { name: 'Recent deliveries to https://deploy.test/gate' }))
      .toBeVisible()
    expect(
      page.getByRole('heading', { name: /Recent deliveries to https:\/\/quiet\.test/ }).elements(),
    ).toHaveLength(0)
    const table = page.getByRole('table', { name: 'Deliveries to https://deploy.test/gate' })
    await expect.element(table.getByText('Timed out')).toBeVisible()
    await expect.element(table.getByText('1 of 8')).toBeVisible()
  })

  it('keeps two webhooks on one host apart: one heading and delivery list each', async () => {
    api({
      webhooks: [
        { ...hook('h1', 'http://localhost:9/one'), deliveries: [delivery('d1', 200)] },
        { ...hook('h2', 'http://localhost:9/two'), deliveries: [delivery('d2', 503)] },
      ],
    })
    await show()
    const one = page.getByRole('heading', { name: 'Recent deliveries to http://localhost:9/one' })
    const two = page.getByRole('heading', { name: 'Recent deliveries to http://localhost:9/two' })
    await expect.element(one).toBeVisible()
    await expect.element(two).toBeVisible()
    expect(
      page
        .getByRole('heading', { name: 'Recent deliveries to localhost:9', exact: true })
        .elements(),
    ).toHaveLength(0)
    const tableOne = page.getByRole('table', { name: 'Deliveries to http://localhost:9/one' })
    const tableTwo = page.getByRole('table', { name: 'Deliveries to http://localhost:9/two' })
    await expect.element(tableOne.getByText('200')).toBeVisible()
    expect(tableOne.getByText('503').elements()).toHaveLength(0)
    await expect.element(tableTwo.getByText('503')).toBeVisible()
  })

  it('says when there are none, and explains how to check a delivery', async () => {
    api()
    await show()
    await expectEmptyState('No webhooks yet', {
      body: 'Send build and review events to another service.',
    })
    await expect.element(page.getByRole('heading', { name: 'Checking a delivery' })).toBeVisible()
    await expect.element(page.getByText(/Reject signatures older than 5 minutes/)).toBeVisible()
    await expect.element(page.getByText(/retried 8 times with backoff/)).toBeVisible()
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

  it("won't add without an event: says so next to the events, and sends nothing", async () => {
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

  it("shows the server's refusal of an address", async () => {
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
    await expect.element(toastNamed('Webhook removed')).toBeVisible()
  })

  it('regenerates a secret only after confirming, then shows the new one once', async () => {
    const fake = api(
      { webhooks: [hook('h1', 'https://a.test/hook')] },
      {
        [`POST ${API}/webhooks/h1/secret`]: {
          body: { webhook: hook('h1', 'https://a.test/hook'), secret: 'whsec_fresh' },
        },
      },
    )
    await show()
    await page.getByRole('button', { name: 'Regenerate secret for https://a.test/hook' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Regenerate secret?' })
    await expect.element(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('button', { name: 'Regenerate secret for https://a.test/hook' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerate' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect.element(toastNamed('Secret regenerated')).toBeVisible()
    await expect.element(page.getByRole('dialog', { name: 'New signing secret' })).toBeVisible()
    await expect.element(page.getByText('whsec_fresh')).toBeVisible()
  })

  it("sends members to the project's settings hub instead of showing the webhooks", async () => {
    api({ canManage: false, webhooks: [hook('h1', 'https://a.test/hook')] })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings')
    expect(page.getByText('https://a.test/hook').elements()).toHaveLength(0)
  })
})
