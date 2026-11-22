import { afterEach, beforeEach, vi } from 'vitest'
import { page } from 'vitest/browser'

import { setPushEnv } from '#features/pwa/push-client.ts'
import { resetStores } from '#lib/stores/index.ts'

import { resetAuthClient } from './auth-client.ts'
import { guardConsole } from './console-guard.ts'
import { installDefaultFetch, takeUnfakedRequests } from './fetch.ts'

// The auth client is the edge to better-auth: a fake stands in for it in every test file (nothing
// here talks to a server). Tests sign in as someone else with `setSignedInUser` / `mockAuthClient`.
vi.mock('#lib/auth-client.ts', () => import('./auth-client.ts').then((m) => m.authClientModule))

// A test fails on a console.error it didn't expect or a promise rejected without a handler.
guardConsole()

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
