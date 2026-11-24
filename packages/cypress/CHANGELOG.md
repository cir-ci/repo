# @circi/cypress

## 0.1.1

### Patch Changes

- [#50](https://github.com/cir-ci/repo/pull/50) [`5629c5e`](https://github.com/cir-ci/repo/commit/5629c5efb7e0f69d56fecca8cf02db82a9fcd98a) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The CLI and the Vitest, Cypress and Storybook plugins are now under the MIT License instead of GPL-3.0-only, so they can be added to any project's dependencies without a license review. The CirCI server stays GPL-3.0-only.
  
  `@circi/cypress` now depends on `tar` instead of bundling a copy of it, like the other packages, so `tar`'s own license (Blue Oak Model License 1.0.0) comes with it and the package is smaller.

## 0.1.0

### Minor Changes

- [#33](https://github.com/cir-ci/repo/pull/33) [`6c341b8`](https://github.com/cir-ci/repo/commit/6c341b8bfaf548da2d019c160f2de8a68fdc1a50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New package `@circi/cypress`: send your Cypress screenshots to CirCI for review. Add `setupNodeEvents: circi({ name: 'cypress-chrome' })` to `cypress.config.ts` and `import '@circi/cypress/support'` to the support file; tests keep `cy.screenshot('name')`. Every named screenshot (not Cypress's automatic failure screenshot) is saved as `.circi/screenshots/cypress/<spec path>/<name>.png`, named `<spec path from the project root>/<name>` in CirCI (so two specs with one file name in different folders stay apart; a name with nothing usable is skipped with a notice) with a `.png.json` sidecar (spec, browser, viewport) and `cypress run` uploads them when it ends, with the same options and token, CI and shard settings as `@circi/vitest` (`CIRCI_SHARD=2/4` for parallel machines). A screenshot shows only what it is of: an element's own box, a page's content (not padded to the viewport), a mounted component (padding on a page stops at the end of the document), and an element with nothing to show is an error. Tested with Cypress 16.3 in Electron. The plugin writes, empties and uploads only its own folder under the shared `dir`. The services package only gains a layer-test exception for the new package's `process.env` use.

### Patch Changes

- [#33](https://github.com/cir-ci/repo/pull/33) [`6c341b8`](https://github.com/cir-ci/repo/commit/6c341b8bfaf548da2d019c160f2de8a68fdc1a50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A full-page screenshot of a tall page no longer times out after 4 seconds on a slow machine: the capture gets the screenshot's own time limit (its `timeout` option, or Cypress's `responseTimeout`).
