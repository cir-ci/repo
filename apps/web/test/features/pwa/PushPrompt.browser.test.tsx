import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { PushPrompt } from '#features/pwa/PushPrompt.tsx'
import { usePwaStore } from '#lib/stores/pwa-store.ts'
import { fixedClock } from '#test/support/clock.ts'
import { fakePushEnv, SUBSCRIPTION } from '#test/support/push-env.ts'
import { renderPage } from '#test/support/render.tsx'

const DAY = 24 * 60 * 60 * 1000
const API = {
  'GET /api/push/public-key': { body: { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa40HI' } },
  'POST /api/push/subscribe': { body: { devices: [] } },
  'GET /api/push/devices': { body: { devices: [] } },
}
const card = () => page.getByRole('status').filter({ hasText: /Get notified/ })
const ready = () => usePwaStore.setState({ pushPermission: 'default' })

describe('PushPrompt', () => {
  it('asks in context once a review is waiting, naming what it pushes', async () => {
    fakePushEnv()
    await renderPage(<PushPrompt hasReview />, { api: API, beforeRender: ready })
    await expect.element(card()).toBeVisible()
    await expect
      .element(page.getByText(/review requests, mentions and rejections of your builds/))
      .toBeVisible()
  })

  it('does not ask before there is a reason: no review waiting and nothing approved', async () => {
    const env = fakePushEnv()
    await renderPage(<PushPrompt hasReview={false} />, { api: API, beforeRender: ready })
    expect(card().elements()).toHaveLength(0)
    expect(env.requestPermission).not.toHaveBeenCalled()
  })

  it('asks after the first approval even when no review is waiting', async () => {
    fakePushEnv()
    await renderPage(<PushPrompt hasReview={false} />, {
      api: API,
      beforeRender: () => usePwaStore.setState({ pushPermission: 'default', approved: true }),
    })
    await expect.element(card()).toBeVisible()
  })

  it("shows the browser's permission box only after Turn on notifications, then subscribes and registers the device", async () => {
    const env = fakePushEnv()
    const api = await renderPage(<PushPrompt hasReview />, { api: API, beforeRender: ready })
    expect(env.requestPermission).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Turn on notifications' }).click()
    await expect.poll(() => env.subscribe.mock.calls.length).toBe(1)
    expect(env.requestPermission).toHaveBeenCalledOnce()
    expect(env.subscribe).toHaveBeenCalledWith('BEl62iUYgUivxIkv69yViEuiBIa40HI')
    const posted = api.calls.find((c) => c.path === '/api/push/subscribe')
    expect(posted?.body).toEqual(SUBSCRIPTION)
    // On now: the offer is gone.
    await expect.poll(() => usePwaStore.getState().pushEndpoint).toBe(SUBSCRIPTION.endpoint)
    expect(card().elements()).toHaveLength(0)
  })

  it('gives way to a note when the browser box is declined, and asks nothing more', async () => {
    const env = fakePushEnv({ answer: 'denied' })
    const api = await renderPage(<PushPrompt hasReview />, { api: API, beforeRender: ready })
    await page.getByRole('button', { name: 'Turn on notifications' }).click()
    await expect.element(page.getByText(/Notifications are blocked for this site\./)).toBeVisible()
    expect(env.subscribe).not.toHaveBeenCalled()
    expect(api.calls.some((c) => c.path === '/api/push/subscribe')).toBe(false)
  })

  it('hides for 14 days on "Not now", at most 3 times', async () => {
    const clock = fixedClock()
    fakePushEnv()
    await renderPage(<PushPrompt hasReview />, { api: API, beforeRender: ready })
    await page.getByRole('button', { name: 'Not now' }).click()
    expect(card().elements()).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('circi-pwa-prompts') ?? '{}').push).toEqual({
      count: 1,
      lastAt: clock.now.getTime(),
    })

    usePwaStore.getState().reset()
    ready()
    clock.tick(13 * DAY)
    await renderPage(<PushPrompt hasReview />, { api: API })
    expect(card().elements()).toHaveLength(0)
    clock.tick(DAY)
    await renderPage(<PushPrompt hasReview />, { api: API })
    await expect.element(card()).toBeVisible()

    localStorage.setItem(
      'circi-pwa-prompts',
      JSON.stringify({ visits: 9, approved: true, install: {}, push: { count: 3, lastAt: 0 } }),
    )
    usePwaStore.getState().reset()
    ready()
    await renderPage(<PushPrompt hasReview />, { api: API })
    expect(card().elements()).toHaveLength(0)
  })

  it.each([
    ['has no push', { pushPermission: 'unsupported' }],
    ['has it blocked', { pushPermission: 'denied' }],
    ['is already on', { pushPermission: 'granted', pushEndpoint: SUBSCRIPTION.endpoint }],
  ] as const)('does not ask where the browser %s', async (_name, state) => {
    fakePushEnv()
    await renderPage(<PushPrompt hasReview />, {
      api: API,
      beforeRender: () => usePwaStore.setState(state),
    })
    expect(card().elements()).toHaveLength(0)
  })
})
