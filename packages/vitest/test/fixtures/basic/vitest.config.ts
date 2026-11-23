import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { circi } from '../../../src/index.ts'

/** A project using the plugin the way a user does; the integration test drives it by environment. */
export default defineConfig({
  plugins: [
    circi({
      local: process.env['FIXTURE_LOCAL'] === '1',
      site: process.env['FIXTURE_SITE'] === '1',
    }),
  ],
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
