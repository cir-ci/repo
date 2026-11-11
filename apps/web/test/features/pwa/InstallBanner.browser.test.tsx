import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { UserMenu } from '#features/auth/UserMenu.tsx'
import { AddToHomeScreenSheet } from '#features/pwa/AddToHomeScreenSheet.tsx'
import { InstallBanner } from '#features/pwa/InstallBanner.tsx'
import { type InstallPromptEvent, usePwaStore } from '#lib/stores/pwa-store.ts'
import { fixedClock, T0 } from '#test/support/clock.ts'
import { renderPage } from '#test/support/render.tsx'

const DAY = 24 * 60 * 60 * 1000
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.restoreAllMocks()
})

/** The browser's install prompt, held by the app until the person asks. */
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn<() => Promise<void>>(async () => {})
  const event: InstallPromptEvent = Object.assign(new Event('beforeinstallprompt'), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  })
  return { event, prompt }
}

const install = () => JSON.parse(localStorage.getItem('circi-pwa-prompts') ?? '{}').install
const banner = () => page.getByRole('status').filter({ hasText: /Install CirCI/ })

describe('InstallBanner', () => {
  it('is not shown on the first visit', async () => {
    await renderPage(<InstallBanner />, {
      beforeRender: () => usePwaStore.setState({ visits: 1, installEvent: installEvent().event }),
    })
    expect(banner().elements()).toHaveLength(0)
  })

  it('is shown from the second visit and starts the browser prompt on Install', async () => {
    const { event, prompt } = installEvent()
    await renderPage(<InstallBanner />, {
      beforeRender: () => usePwaStore.setState({ visits: 2, installEvent: event }),
    })
    await expect.element(banner()).toBeVisible()
    await expect.element(page.getByText(/to open it in its own window\./)).toBeVisible()
    await page.getByRole('button', { name: 'Install' }).click()
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    // The prompt can be used once.
    expect(usePwaStore.getState().installEvent).toBeNull()
  })

  it('is shown after the first approval even on the first visit', async () => {
    await renderPage(<InstallBanner />, {
      beforeRender: () =>
        usePwaStore.setState({ visits: 1, approved: true, installEvent: installEvent().event }),
    })
    await expect.element(banner()).toBeVisible()
  })

  it('is not shown where the browser cannot install, or once installed', async () => {
    await renderPage(<InstallBanner />, {
      beforeRender: () => usePwaStore.setState({ visits: 5, installEvent: null }),
    })
    expect(banner().elements()).toHaveLength(0)
  })

  it('hides for 14 days on "Not now", remembered, and comes back after them, at most 3 times', async () => {
    const clock = fixedClock()
    await renderPage(<InstallBanner />, {
      beforeRender: () => usePwaStore.setState({ visits: 3, installEvent: installEvent().event }),
    })
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect.poll(() => banner().elements()).toHaveLength(0)
    await expect.poll(() => install()?.count).toBe(1)
    // The pinned clock may have moved on a little since the click.
    expect(install().lastAt).toBeGreaterThanOrEqual(T0.getTime())
    expect(install().lastAt).toBeLessThanOrEqual(clock.now.getTime())

    // Another visit, 13 days later: still hidden; 14 days later: shown again.
    usePwaStore.getState().reset()
    usePwaStore.setState({ installEvent: installEvent().event })
    clock.tick(13 * DAY)
    await renderPage(<InstallBanner />)
    expect(banner().elements()).toHaveLength(0)
    clock.tick(DAY)
    await renderPage(<InstallBanner />)
    await expect.element(banner()).toBeVisible()

    // After the third "Not now" it stays away for good.
    localStorage.setItem(
      'circi-pwa-prompts',
      JSON.stringify({ visits: 9, approved: false, install: { count: 3, lastAt: 0 }, push: {} }),
    )
    usePwaStore.getState().reset()
    usePwaStore.setState({ installEvent: installEvent().event })
    await renderPage(<InstallBanner />)
    expect(banner().elements()).toHaveLength(0)
  })

  it('on an iPhone offers the Add to Home Screen steps instead of a prompt', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
    await renderPage(
      <>
        <InstallBanner />
        <AddToHomeScreenSheet />
      </>,
      { beforeRender: () => usePwaStore.setState({ visits: 2 }) },
    )
    await expect.element(page.getByText(/Add CirCI to your home screen\./)).toBeVisible()
    await page.getByRole('button', { name: 'Install' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add CirCI to your Home Screen' })
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByText('Tap Share in the Safari toolbar')).toBeVisible()
    await expect.element(sheet.getByText('Choose Add to Home Screen')).toBeVisible()
    await expect
      .element(sheet.getByText('Open CirCI from the Home Screen, then turn on notifications'))
      .toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect.poll(() => usePwaStore.getState().sheetOpen).toBe(false)
  })
})

const open = () => page.getByRole('button', { name: /Account menu/ }).click()

describe('the account menu', () => {
  const user = { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null }
  it('has an Install app item while the app can be installed, and starts the install', async () => {
    const { event, prompt } = installEvent()
    await renderPage(<UserMenu user={user} />, {
      api: { 'GET /api/capabilities': { body: {} } },
      beforeRender: () => usePwaStore.setState({ installEvent: event }),
    })
    await open()
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  })

  it('has no Install app item once installed or where it cannot be', async () => {
    await renderPage(<UserMenu user={user} />, {
      api: { 'GET /api/capabilities': { body: {} } },
      beforeRender: () =>
        usePwaStore.setState({ installEvent: installEvent().event, installed: true }),
    })
    await open()
    await expect.element(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()
    expect(page.getByRole('menuitem', { name: 'Install app' }).elements()).toHaveLength(0)
  })
})
