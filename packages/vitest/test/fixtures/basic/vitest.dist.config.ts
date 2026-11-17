import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { circi } from '../../../dist/index.mjs'

/** The same project, with the plugin as it is published (the built package). */
export default defineConfig({
  plugins: [circi({ local: process.env['FIXTURE_LOCAL'] === '1' })],
  test: {
    include: ['*.fixture.mjs'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
