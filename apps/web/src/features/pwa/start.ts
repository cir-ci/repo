import { usePwaStore, type InstallPromptEvent } from '#lib/stores/pwa-store.ts'

import { currentPlatform } from './platform.ts'
import { refreshPushState } from './push-client.ts'

const SESSION_KEY = 'circi-visit-counted'

/** Counts this tab's session once as a visit to the dashboard (a reload is not a new visit). */
function countVisit(): void {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // No session storage: every load counts, which only makes the install offer a little earlier.
  }
  usePwaStore.getState().recordVisit()
}

/**
 * Starts what makes the dashboard an installable app, once, when the page loads: the service
 * worker (in a build only; the dev server has none), the visit count, whether it already runs
 * installed, the browser's install prompt (kept until the person asks for it) and this
 * browser's push state.
 */
export function startPwa(): void {
  const store = usePwaStore.getState()
  countVisit()
  store.setInstalled(currentPlatform().standalone)

  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold it: the person starts the install from the banner or the account menu.
    event.preventDefault()
    // The browser's event, with the install methods the DOM types don't have.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    usePwaStore.getState().setInstallEvent(event as InstallPromptEvent)
  })
  window.addEventListener('appinstalled', () => {
    usePwaStore.getState().setInstallEvent(null)
    usePwaStore.getState().setInstalled(true)
  })
  try {
    window
      .matchMedia('(display-mode: standalone)')
      .addEventListener('change', (e) => usePwaStore.getState().setInstalled(e.matches))
  } catch {
    // No matchMedia.
  }

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    if (document.readyState === 'complete') void registerWorker()
    else window.addEventListener('load', () => void registerWorker(), { once: true })
  } else {
    void refreshPushState()
  }
}

/** The worker serves the app shell and shows pushes; a browser or network that refuses it still runs the dashboard. */
function registerWorker(): Promise<void> {
  return navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(() => {
      void askForPrecache()
      return refreshPushState()
    })
    .catch(() => undefined)
}

/**
 * Once the page is idle after the first load, the worker fetches this build's other files in the
 * background (`src/sw/precache.ts`), so the next pages open without waiting on the network.
 */
async function askForPrecache(): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const ask = () => registration.active?.postMessage({ type: 'precache' })
  if ('requestIdleCallback' in window) window.requestIdleCallback(ask, { timeout: 10_000 })
  else setTimeout(ask, 3000)
}
