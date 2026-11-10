import { afterEach, beforeEach, vi } from 'vitest'
import { page } from 'vitest/browser'

import { setPushEnv } from '#features/pwa/push-client.ts'
import { resetStores } from '#lib/stores/index.ts'

import { resetAuthClient } from './auth-client.ts'
import { installDefaultFetch, takeUnfakedRequests } from './fetch.ts'

// Every browser test file starts from the same clean page: no leftover fake, mock, timer, store
// state or stored value from the test before it.
beforeEach(() => {
  takeUnfakedRequests()
  installDefaultFetch()
})

afterEach(async () => {
  // A phone-sized test leaves the window as it found it for the next one.
  await page.viewport(1000, 700)
  const unfaked = takeUnfakedRequests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resetAuthClient()
  resetStores()
  setPushEnv()
  localStorage.clear()
  sessionStorage.clear()
  if (unfaked.length > 0) throw new Error(`Unfaked requests:\n${unfaked.join('\n')}`)
})
