# @circi/cypress

The [CirCI](https://circi.dev) plugin for Cypress. Your tests keep Cypress's own `cy.screenshot('name')`; the plugin copies each named screenshot to `.circi/screenshots/<spec file>/<name>.png` and `cypress run` uploads them to your CirCI server when it ends. CirCI compares and reviews them.

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

The screenshots are named `<spec file>/<name>`, like `@circi/vitest` names its own: `home.cy.ts/home`, `home.cy.ts/header`. Always pass a name. Renaming a spec file starts new baselines.

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

Every screenshot a run takes with a name. Cypress's automatic screenshot of a failing test, and a `cy.screenshot()` without a name, are not. Each file gets a `.png.json` next to it with the spec, the browser and the viewport, which CirCI keeps with the screenshot. The upload happens in `cypress run` only (not in `cypress open`), and a run uploads only its own screenshots: the folder is emptied when it starts.

The upload is the same code as `circi upload`: `CIRCI_API_URL` and `CIRCI_TOKEN` say where and who, and the commit, branch and pull request come from your CI. Without them the plugin prints `[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots` and the run is unaffected, as with `@circi/vitest`.

## What a screenshot shows

The support file keeps `cy.screenshot()`'s signature and what it yields, and changes what it captures so that a screenshot holds the thing and nothing around it:

- **An element** (`cy.get(sel).screenshot('x')`): its own box, cropped tight.
- **The page** (`cy.screenshot('x')`): the content of the page, as tall as the content is. A short page isn't padded to the viewport's height, and Cypress's own interface isn't in it.
- **Component testing**: the mounted component's box (the one element inside `[data-cy-root]`), not the viewport.
- An element with no size, or one that is hidden, is an error (`nothing to capture`), not a blank image.
- `padding` adds space on purpose: `cy.get(sel).screenshot('x', { padding: 10 })`. On a page it adds space below the content.
- An explicit `capture` or `clip` is left as you wrote it.

Before it captures, it also waits for fonts, and stops animations and the caret. It sets `Cypress.Screenshot.defaults` to `capture: 'fullPage'` and `disableTimersAndAnimations: true`.

## Options

The same options, names and defaults as the `@circi/vitest` reporter:

| Option    | Default                 | Meaning                                                                    |
| --------- | ----------------------- | -------------------------------------------------------------------------- |
| `apiUrl`  | `CIRCI_API_URL`         | CirCI address.                                                             |
| `token`   | `CIRCI_TOKEN`           | Project CI token.                                                          |
| `name`    | `cypress`               | Build name; give each browser or suite its own (`cypress-chrome`).         |
| `dir`     | `.circi/screenshots`    | Where screenshots are written, relative to the project root.               |
| `clean`   | `true`                  | Empty `dir` when the run starts.                                           |
| `root`    | Cypress's `projectRoot` | Project root to look in.                                                   |
| `wait`    | `false`                 | Wait for the result and fail the run while changes need review.            |
| `strict`  | `false`                 | Also fail the run if the upload fails. By default tests pass or fail alone. |
| `shard`   | `CIRCI_SHARD` (`2/4`)   | This machine's shard (`{ index, total }`, `index` from 0) of a parallel run. |

With `wait`, the run fails (a non-zero exit code) while changes need review. With machines running one run in parallel, give each its shard (the same `name` on every machine): they become one CirCI build, processed once all of them have uploaded.

Tested with Cypress 16.3 (Electron, end-to-end and component testing); needs Node 22 or later. `peerDependencies` allows Cypress 13 or later, which hasn't been tried.

- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/cypress/CHANGELOG.md)

Licensed under the GNU GPL v3.
