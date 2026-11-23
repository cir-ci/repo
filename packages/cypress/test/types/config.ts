import { defineConfig } from 'cypress'

import { circi } from '#src/index.ts'

// The plugin plugs into Cypress's own config types, alone or inside a setupNodeEvents.
export default defineConfig({
  e2e: { setupNodeEvents: circi({ name: 'cypress-chrome', wait: true }) },
  component: {
    devServer: { framework: 'react', bundler: 'vite' },
    setupNodeEvents(on, config) {
      circi({ shard: { index: 0, total: 2 } })(on, config)
      return config
    },
  },
})
