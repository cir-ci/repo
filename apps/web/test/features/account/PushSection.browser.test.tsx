import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { NotificationsPage } from '#features/account/NotificationsPage.tsx'
import { AddToHomeScreenSheet } from '#features/pwa/AddToHomeScreenSheet.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'
import { fixedClock } from '#test/support/clock.ts'
import { fakePushEnv, SUBSCRIPTION } from '#test/support/push-env.ts'
import { renderPage } from '#test/support/render.tsx'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.restoreAllMocks()
})

const PREFS = {
  emailReviewRequested: true,
  emailReviewOverdue: true,
  pushReviewRequested: true,
  pushMentioned: false,
  pushReviewOutcome: true,
}
const DEVICES = {
  devices: [
    {
      id: 'd-this',
      endpoint: SUBSCRIPTION.endpoint,
      label: 'Chrome on Android',
      createdAt: '2026-11-10T09:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: 'd-mac',
      endpoint: 'https://push.example.com/send/mac',
      label: 'Chrome on Mac',
      createdAt: '2026-10-01T09:00:00.000Z',
      lastUsedAt: '2026-11-09T09:00:00.000Z',
    },
    {
      id: 'd-pc',
      endpoint: 'https://push.example.com/send/pc',
      label: 'Edge on Windows',
      createdAt: '2026-09-01T09:00:00.000Z',
      lastUsedAt: null,
    },
  ],
}
const API = {
  'GET /api/inbox/preferences': { body: PREFS },
  'GET /api/capabilities': { body: { mailConfigured: true } },
  'GET /api/push/devices': { body: DEVICES },
}
const here = () => page.getByRole('switch', { name: 'Push notifications on this device' })
const kind = (name: string) => page.getByRole('switch', { name: `Push: ${name}` })

describe('Push notifications in settings', () => {
  it('says so in a browser without push, with no switch, and no kinds to push', async () => {
    await page.viewport(1000, 900)
    await renderPage(<NotificationsPage />, { api: API })
    await expect.element(page.getByRole('heading', { name: 'In your Inbox' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible()
    await expect.element(page.getByText(/background worker isn't running/)).toBeVisible()
    expect(here().elements()).toHaveLength(0)
    expect(page.getByRole('heading', { name: 'What to push' }).elements()).toHaveLength(0)
  })

  it('reads the browser again when the page opens, for an installed app whose worker was not ready at start', async () => {
    await page.viewport(390, 844)
    fakePushEnv({ permission: 'default' })
    await renderPage(<NotificationsPage />, {
      api: API,
      // The app started before its worker was ready: the store still says unsupported.
      beforeRender: () => usePwaStore.setState({ pushPermission: 'unsupported', installed: true }),
    })
    await expect.element(here()).toBeVisible()
    await expect.element(here()).not.toBeChecked()
    // Installed: push is the first section of the page.
    const headings = page.getByRole('heading', { level: 2 }).elements()
    expect(headings[0]?.textContent).toBe('Push notifications')
  })

  it('lists this device first with its state, then the other devices', async () => {
    await page.viewport(1000, 900)
    fixedClock(new Date('2026-11-10T12:00:00.000Z'))
    fakePushEnv({ permission: 'granted' })
    await renderPage(<NotificationsPage />, {
      api: API,
      beforeRender: () =>
        usePwaStore.setState({ pushPermission: 'granted', pushEndpoint: SUBSCRIPTION.endpoint }),
    })
    await expect.element(page.getByText('Chrome on Android')).toBeVisible()
    await expect.element(page.getByText('This device')).toBeVisible()
    await expect.element(page.getByText(/On since Nov 10/)).toBeVisible()
    await expect.element(here()).toBeChecked()
    await expect.element(page.getByText('Chrome on Mac')).toBeVisible()
    await expect.element(page.getByText(/Last used yesterday/)).toBeVisible()
    await expect.element(page.getByText('Not used yet')).toBeVisible()
    // The device in hand is not among the others.
    expect(page.getByRole('button', { name: /^Remove/ }).elements()).toHaveLength(2)
  })

  it('turns this device on as the switch flips: permission, subscription, and the server told', async () => {
    await page.viewport(1000, 900)
    const env = fakePushEnv()
    const api = await renderPage(<NotificationsPage />, {
      api: {
        ...API,
        'GET /api/push/public-key': { body: { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa40HI' } },
        'POST /api/push/subscribe': { body: DEVICES },
      },
      beforeRender: () => usePwaStore.setState({ pushPermission: 'default' }),
    })
    await expect.element(here()).not.toBeChecked()
    await here().click()
    await expect.poll(() => env.subscribe.mock.calls.length).toBe(1)
    await expect.element(here()).toBeChecked()
    expect(api.calls.find((c) => c.path === '/api/push/subscribe')?.body).toEqual(SUBSCRIPTION)
    // No Save button: it saved as it flipped.
    expect(page.getByRole('button', { name: /^Save/ }).elements()).toHaveLength(0)
  })

  it('turns this device off: the browser subscription is dropped and the server is told', async () => {
    await page.viewport(1000, 900)
    const env = fakePushEnv({ permission: 'granted' })
    const api = await renderPage(<NotificationsPage />, {
      api: { ...API, 'POST /api/push/unsubscribe': { body: { ok: true } } },
      beforeRender: () =>
        usePwaStore.setState({ pushPermission: 'granted', pushEndpoint: SUBSCRIPTION.endpoint }),
    })
    await here().click()
    await expect.element(here()).not.toBeChecked()
    expect(env.unsubscribe).toHaveBeenCalledOnce()
    expect(api.calls.find((c) => c.path === '/api/push/unsubscribe')?.body).toEqual({
      endpoint: SUBSCRIPTION.endpoint,
    })
  })

  it('says it is blocked, with the switch disabled, when the browser refused', async () => {
    await page.viewport(1000, 900)
    fakePushEnv({ permission: 'denied' })
    await renderPage(<NotificationsPage />, {
      api: { ...API, 'GET /api/push/devices': { body: { devices: [] } } },
      beforeRender: () => usePwaStore.setState({ pushPermission: 'denied' }),
    })
    await expect.element(page.getByText(/Notifications are blocked for this site\./)).toBeVisible()
    await expect
      .element(page.getByText(/Allow them in your browser's or device's settings/))
      .toBeVisible()
    await expect.element(here()).toBeDisabled()
  })

  it('removes another device with Remove, and keeps this one', async () => {
    await page.viewport(1000, 900)
    fakePushEnv({ permission: 'granted' })
    const after = { devices: DEVICES.devices.filter((d) => d.id !== 'd-mac') }
    const api = await renderPage(<NotificationsPage />, {
      api: { ...API, 'DELETE /api/push/devices/d-mac': { body: after } },
      beforeRender: () =>
        usePwaStore.setState({ pushPermission: 'granted', pushEndpoint: SUBSCRIPTION.endpoint }),
    })
    await page.getByRole('button', { name: 'Remove Chrome on Mac' }).click()
    await expect.poll(() => page.getByText('Chrome on Mac').elements().length).toBe(0)
    expect(
      api.calls.some((c) => c.method === 'DELETE' && c.path === '/api/push/devices/d-mac'),
    ).toBe(true)
    await expect.element(page.getByText('Edge on Windows')).toBeVisible()
    await expect.element(here()).toBeChecked()
  })

  it('shows the kinds to push next to email, as saved, and saves one the moment it flips', async () => {
    await page.viewport(1000, 900)
    fakePushEnv({ permission: 'granted' })
    let prefs = PREFS
    const api = await renderPage(<NotificationsPage />, {
      api: {
        ...API,
        'GET /api/inbox/preferences': () => ({ body: prefs }),
        'PUT /api/inbox/preferences': (body) => {
          prefs = { ...prefs, ...Object.fromEntries(Object.entries(body ?? {})) }
          return { body: prefs }
        },
      },
      beforeRender: () =>
        usePwaStore.setState({ pushPermission: 'granted', pushEndpoint: SUBSCRIPTION.endpoint }),
    })
    await expect.element(kind('Review requested')).toBeChecked()
    await expect.element(kind('Mentioned')).not.toBeChecked()
    await expect.element(kind('Rejected or approved')).toBeChecked()
    await kind('Mentioned').click()
    await expect.element(kind('Mentioned')).toBeChecked()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ pushMentioned: true })
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  })

  it('on an iPhone that is not on the Home Screen, replaces the switch with the steps', async () => {
    await page.viewport(1000, 900)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
    await renderPage(
      <>
        <NotificationsPage />
        <AddToHomeScreenSheet />
      </>,
      { api: { ...API, 'GET /api/push/devices': { body: { devices: [] } } } },
    )
    expect(here().elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Add to Home Screen' }).click()
    await expect
      .element(page.getByRole('dialog', { name: 'Add CirCI to your Home Screen' }))
      .toBeVisible()
  })
})
