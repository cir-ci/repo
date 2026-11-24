import { afterEach, vi } from 'vitest'

// Timestamps and Intl output must not depend on the machine's zone or language.
process.env['TZ'] = 'UTC'
process.env['LC_ALL'] = 'en_US.UTF-8'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
