---
'@circi/cypress': minor
'@circi/services': patch
---

New package `@circi/cypress`: send your Cypress screenshots to CirCI for review. Add `setupNodeEvents: circi({ name: 'cypress-chrome' })` to `cypress.config.ts` and `import '@circi/cypress/support'` to the support file; tests keep `cy.screenshot('name')`. Every named screenshot (not Cypress's automatic failure screenshot) is saved as `.circi/screenshots/<spec file>/<name>.png` with a `.png.json` sidecar (spec, browser, viewport) and `cypress run` uploads them when it ends, with the same options and token, CI and shard settings as `@circi/vitest` (`CIRCI_SHARD=2/4` for parallel machines). A screenshot shows only what it is of: an element's own box, a page's content (not padded to the viewport), a mounted component, and an element with nothing to show is an error. Tested with Cypress 16.3 in Electron. The services package only gains a layer-test exception for the new package's `process.env` use.
