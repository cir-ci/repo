import { circi } from '@circi/cypress'
import { defineConfig } from 'cypress'

const setupNodeEvents = circi({
  name: 'cypress-fixture',
  wait: process.env.FIXTURE_WAIT === '1',
  strict: process.env.FIXTURE_STRICT === '1',
})

// A project as a user writes it: the plugin in setupNodeEvents, the support file imports the package.
export default defineConfig({
  video: false,
  viewportWidth: 800,
  viewportHeight: 600,
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    setupNodeEvents,
  },
  component: {
    specPattern: 'cypress/component/**/*.cy.js',
    supportFile: 'cypress/support/component.js',
    indexHtmlFile: 'cypress/support/component-index.html',
    devServer: { bundler: 'vite' },
    setupNodeEvents,
  },
})
