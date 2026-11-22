# @circi/cypress

The [CirCI](https://circi.dev) plugin for Cypress. Your tests keep Cypress's own `cy.screenshot('name')`; the plugin copies each named screenshot to `.circi/screenshots/cypress/<spec path>/<name>.png` and `cypress run` uploads them to your CirCI server when it ends. CirCI compares and reviews them.

```ts
// cypress.config.ts
import { circi } from '@circi/cypress'
import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    setupNodeEvents: circi({ name: 'cypress-chrome' }),
  },
})
```

```ts
// cypress/support/e2e.ts (and component.ts)
import '@circi/cypress/support'
```

```ts
cy.visit('/')
cy.screenshot('home')
cy.get('header').screenshot('header')
```

The screenshots are named `<spec path from the project root>/<name>`, like `@circi/vitest` names its own: `cypress/e2e/home.cy.ts/home`, `cypress/e2e/home.cy.ts/header`. The whole path is in the name, so `admin/home.cy.ts` and `public/home.cy.ts` never share a screenshot. Always pass a name: one with nothing usable in it (`'!!'`) is skipped with a `[circi] skipped screenshot` notice, and the test is unaffected. Renaming or moving a spec file starts new baselines.

If you already have a `setupNodeEvents`, call the plugin inside it:

```ts
setupNodeEvents(on, config) {
  circi({ name: 'cypress-chrome' })(on, config)
  // your own setup
  return config
}
```

Cypress keeps one handler per event (`before:run`, `after:screenshot`, `after:run`), so a handler of your own for one of them replaces the plugin's or the other way round: use a helper such as `cypress-on-fix` if you need both.

## What is uploaded

Every screenshot a run takes with a name. Cypress's automatic screenshot of a failing test, and a `cy.screenshot()` without a name, are not. Each file gets a `.png.json` next to it with the spec, the browser and the viewport, which CirCI keeps with the screenshot. The upload happens in `cypress run` only (not in `cypress open`). Each tool keeps its own folder under `dir`, and the plugin writes, empties (when a run starts, so a build holds only that run's screenshots) and uploads only `<dir>/cypress`: another tool's folder, like `@circi/vitest`'s, is never touched.

The upload is the same code as `circi upload`: `CIRCI_API_URL` and `CIRCI_TOKEN` say where and who, and the commit, branch and pull request come from your CI. Without them the plugin prints `[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots` and the run is unaffected, as with `@circi/vitest`.

## What a screenshot shows

The support file keeps `cy.screenshot()`'s signature and what it yields, and changes what it captures so that a screenshot holds the thing and nothing around it:

- **An element** (`cy.get(sel).screenshot('x')`): its own box, cropped tight.
- **The page** (`cy.screenshot('x')`): the content of the page, as tall as the content is. A short page isn't padded to the viewport's height, and Cypress's own interface isn't in it.
- **Component testing**: the mounted component's box (the one element inside `[data-cy-root]`), not the viewport.
- An element with no size, or one that is hidden, is an error (`nothing to capture`), not a blank image.
- `padding` adds space on purpose: `cy.get(sel).screenshot('x', { padding: 10 })`. On a page it adds space below the content, up to the end of the document.
- An explicit `capture` or `clip` is left as you wrote it.

Before it captures, it also waits for fonts, and stops animations and the caret. It sets `Cypress.Screenshot.defaults` to `capture: 'fullPage'` and `disableTimersAndAnimations: true`.

## Options

The same options, names and defaults as the `@circi/vitest` reporter:

| Option    | Default                 | Meaning                                                                    |
| --------- | ----------------------- | -------------------------------------------------------------------------- |
| `apiUrl`  | `CIRCI_API_URL`         | CirCI address.                                                             |
| `token`   | `CIRCI_TOKEN`           | Project CI token.                                                          |
| `name`    | `cypress`               | Build name; give each browser or suite its own (`cypress-chrome`).         |
| `dir`     | `.circi/screenshots`    | The folder shared by the tools; this plugin uses `<dir>/cypress`, relative to the project root. |
| `clean`   | `true`                  | Empty `<dir>/cypress` (only that folder) when the run starts.              |
| `root`    | Cypress's `projectRoot` | Project root to look in.                                                   |
| `wait`    | `false`                 | Wait for the result and fail the run while changes need review.            |
| `strict`  | `false`                 | Also fail the run if the upload fails. By default tests pass or fail alone. |
| `shard`   | `CIRCI_SHARD` (`2/4`)   | This machine's shard (`{ index, total }`, `index` from 0) of a parallel run. |

With `wait`, the run fails (a non-zero exit code) while changes need review. With machines running one run in parallel, give each its shard (the same `name` on every machine): they become one CirCI build, processed once all of them have uploaded.

Tested with Cypress 16.3 (Electron, end-to-end and component testing); needs Node 22 or later. `peerDependencies` allows Cypress 13 or later, which hasn't been tried.

- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/cypress/CHANGELOG.md)

Licensed under the GNU GPL v3.
