# Vitest

`@circi/vitest` takes screenshots from Vitest browser mode that stay the same between runs, and uploads them to CirCI when the run ends.

> Status: the reporter, collection, shard mapping and screenshot naming are unit-tested, and `circiScreenshot` has been run for real: CirCI's own design system is screenshotted with it in Vitest browser mode on Playwright's Chromium and uploaded to a CirCI stack (`pnpm test:visual`, `e2e/test/dogfood.e2e.test.ts`; see "Running CirCI's own visual tests" below). WebDriver is untried. `toMatchScreenshot` collection is only tested against fixture folders.

## Setup

```ts
// vitest.config.ts
import { CirciReporter } from '@circi/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['default', new CirciReporter({ name: 'vitest-chromium' })],
    browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] },
  },
})
```

```ts
// button.test.ts
import { circiScreenshot } from '@circi/vitest/browser'
import { page } from 'vitest/browser'

it('primary button', async () => {
  render(<Button variant="primary">Save</Button>)
  await circiScreenshot(page, 'button/primary')
})
```

Import `circiScreenshot` from `@circi/vitest/browser`, not `@circi/vitest`: the main entry also holds the reporter, which needs Node (files, the network) and cannot be bundled for the browser.

`circiScreenshot` turns CSS animation and transitions off, waits for fonts and two animation frames, then saves `<project root>/.circi/screenshots/button/primary.png` (Vitest saves a relative `path` next to the test file, so the helper makes it absolute under the Vitest project's root, which is also where the reporter looks). Both a locator (`page.getByRole(...)`, `page.elementLocator(el)`) and `page` itself work as the target. Names are lowercased and `/` makes folders. Set `CIRCI_API_URL` and `CIRCI_TOKEN` in CI; without them the reporter prints a line and does nothing, and the pictures stay in `.circi/screenshots` (gitignore it). Delete that folder before a run (a Vitest `globalSetup` is the place), or pictures of tests you removed are uploaded again.

Reporters are a root-level Vitest option, not per project: with several projects, one `CirciReporter` collects what all of them saved.

## Using `toMatchScreenshot`

Already using Vitest's `expect(...).toMatchScreenshot()`? Set `collectToMatchScreenshot: true` on the reporter and the pictures it keeps in `__screenshots__` folders are uploaded too (its `-actual` and `-diff` pictures are skipped). CirCI then does the comparing and review; keep or drop Vitest's own assertion as you prefer.

## One build per browser, and shards

Give each browser project its own reporter `name` (`vitest-chromium`, `vitest-firefox`) so each has its own baselines. `vitest --shard=2/4` is picked up automatically and uploaded as shard 2 of 4 of the same build.

## Options

`apiUrl`, `token` (default to the `CIRCI_*` variables), `name`, `dir`, `collectToMatchScreenshot`, `root`, `wait` (fail the run when changes need review), `strict` (fail the run when the upload fails; by default a failed upload never changes the test result).

## Running CirCI's own visual tests

CirCI screenshots its own design system with this package: `packages/ui/visual/ui.visual.test.tsx` renders every component's case (the `.design-sync/previews` files, plus `packages/ui/visual/cases.tsx` for Button, TextField, Dialog, ColorSchemeControl and the icons) in light and dark and names the pictures `<component>/<case>/<scheme>`. The team `ui-visual` exists only when `VISUAL=1`, so `pnpm test` never takes them.

```sh
pnpm test:visual                    # no CIRCI_* variables: pictures are saved to .circi/screenshots, the run passes
```

To upload to a local CirCI (a dev stack, or any server you can reach), create a team, copy its CI token and:

```sh
CIRCI_API_URL=http://localhost:3000 CIRCI_TOKEN=circi_... CIRCI_BRANCH=main pnpm test:visual
```

The reporter is configured with `wait: true`, so the run exits 1 while the build has changes that need review (the first build always does): approve it in the dashboard and the next run on the same code exits 0. `CIRCI_COMMIT` / `CIRCI_BRANCH` override what is read from git, as for `circi upload`. `e2e/test/dogfood.e2e.test.ts` does exactly this on a throwaway stack: upload, approve, upload again, expect `no_changes`.

Notes from making it stable: fixed viewport (1000x700), fonts from `@fontsource-variable/*` imported by the test file, and `circiScreenshot`'s own animation/caret stabilisation. Previews outside any package need `react` and `@circi/ui` aliased (see `vitest.config.ts`).
