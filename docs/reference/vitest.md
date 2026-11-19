# Vitest

`@circi/vitest` is a Vitest plugin: tests keep using `toMatchScreenshot` in browser mode, and the screenshots are uploaded to CirCI when the run ends.

> Status: tested against real Vitest 5.1 browser mode on Playwright's Chromium (`packages/vitest/test/plugin.integration.test.ts`, on the fixture project `packages/vitest/test/fixtures/basic`, with the plugin from source and from the built package), and CirCI's own design system is screenshotted this way and uploaded to a CirCI stack (`pnpm test:visual`, `e2e/test/platform/dogfood.browser.e2e.test.ts`; see "Running CirCI's own visual tests" below). The upload itself is only tested against a fake in the unit tests. WebDriver is untried; Firefox and WebKit are untried.

## Setup

Tests keep Vitest's own `toMatchScreenshot`; no CirCI import goes in a test file. Add the plugin to `vitest.config.ts`:

```ts
// vitest.config.ts
import { circi } from '@circi/vitest'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [circi({ name: 'vitest-chromium' })],
  test: {
    browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
  },
})
```

```tsx
// button.test.tsx
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'

it('primary button', async () => {
  render(<Button variant="primary">Save</Button>)
  await expect.element(page.getByRole('button')).toMatchScreenshot('button/primary')
})
```

The plugin registers the reporter (beside the default one, or beside the reporters you list) and a browser setup file that replaces `toMatchScreenshot`. Each call waits for fonts and two animation frames (CSS animation, transitions and the caret are off), then writes `<project root>/.circi/screenshots/<test file>/<name>.png` (`/` in the name makes folders). The reporter empties that folder when the run starts and uploads what the run wrote when it ends, so screenshots of tests you removed are never uploaded again. Set `CIRCI_API_URL` and `CIRCI_TOKEN` in CI; without them the reporter prints a line and does nothing, and the screenshots stay in `.circi/screenshots` (gitignore it).

A screenshot is named by its test file (relative to the project root) and the name you pass. A call without a name gets Vitest's generated name, `<describe> > <test> <n>` with `n` counting the test's calls from 1, which is the same on every run as long as the test's title and the order of its calls stay the same; give a name to any screenshot that must survive a rename. Two calls with the same name in one file overwrite each other.

The target can be a locator (`page.getByRole(...)`), an element, or `page`. `screenshotOptions` (mask, clip, `fullPage`) are passed to Playwright; Vitest's other options (`comparatorName`, thresholds, `timeout`) only apply with `local: true`.

## `local`: who gates

`local` defaults to `false`: nothing is compared or stored on the machine that runs the tests, a test never fails on pixels, and `__screenshots__` is never written. CirCI is the gate (use `wait: true` to fail the run while changes need review).

`local: true` also runs Vitest's normal comparison: references are saved next to the tests (the first run of a new screenshot fails, as in Vitest), a changed screenshot fails the test, and the captures are uploaded as well. Use it to keep committed references while you adopt CirCI.

## How it works, and what could break on a Vitest upgrade

Vitest writes a reference and fails the test when none exists, before it asks a comparator anything; its screenshot options (`resolveScreenshotPath`, `comparators`) can move or loosen a comparison but can't skip it. So with `local: false` the setup file registers its own `toMatchScreenshot` with `expect.extend` (public API) that takes the capture with the public locator `screenshot` and returns a pass. With `local: true` it takes the capture, then calls Vitest's matcher, read from `chai.Assertion.prototype.toMatchScreenshot` before it is replaced; that read is the one thing tied to Vitest's internals, and the plugin throws a clear error when the matcher isn't there. `local: false` depends only on `expect.extend`, `page` and `locator.screenshot`. Only Vitest 5.1 is tested; the peer range stays `>=4`, so an older Vitest is untried. The setup file is added to the project's `setupFiles`, and does nothing in a project that isn't a browser project.

## Migrating from `circiScreenshot`

`circiScreenshot` (from `@circi/vitest/browser`) was deprecated in 0.2.0 and removed in 0.3.0, along with `screenshotPath`. To move: add `circi()` to `plugins` (replacing `new CirciReporter(...)` in `reporters`), then change each call:

```ts
// before
await circiScreenshot(page.getByRole('button'), 'button/primary')
// after
await expect.element(page.getByRole('button')).toMatchScreenshot('button/primary')
```

What changes: the screenshot's name in CirCI now starts with the test file (`src/button.test.tsx/button/primary`, was `button/primary`), names keep their case (they were lowercased), and a build's screenshots appear as removed and added once, so approve that build. Remove the `globalSetup` that emptied `.circi/screenshots`: the reporter does it. `collectToMatchScreenshot` is removed: `local: true` covers it (the plugin uploads every `toMatchScreenshot` capture, and Vitest keeps comparing against `__screenshots__`).

## One build per browser, and shards

One plugin uploads one build. For several browsers, run Vitest once per browser (`vitest --project chromium`) with its own `name` (`vitest-chromium`, `vitest-firefox`) so each has its own baselines; captures of two browsers in one run would share a path. `vitest --shard=2/4` is picked up automatically and uploaded as shard 2 of 4 of the same build.

## Options

`circi(options)` takes `local`, and the reporter's options: `apiUrl`, `token` (default to the `CIRCI_*` variables), `name`, `dir` (default `.circi/screenshots`), `root`, `wait` (fail the run when changes need review), `strict` (fail the run when the upload fails; by default a failed upload never changes the test result). `CirciReporter` is still exported for a hand-written setup (add `clean: true` to empty `dir` at the start).

## Running CirCI's own visual tests

CirCI screenshots its own design system with this package: `packages/ui/visual/ui.visual.test.tsx` renders every component's case (the `packages/ui/visual/previews` files, plus `packages/ui/visual/cases.tsx` for Button, TextField, Dialog, ColorSchemeControl and the icons) in light and dark and calls `toMatchScreenshot('<component>/<case>/<scheme>')`. The plugin is in the root `vitest.config.ts`, and only with `VISUAL=1`. The project `ui-visual` exists only when `VISUAL=1`, so `pnpm test` never takes them.

```sh
pnpm test:visual                    # no CIRCI_* variables: pictures are saved to .circi/screenshots, the run passes
```

To upload to a local CirCI (a dev stack, or any server you can reach), create a project, copy its CI token and:

```sh
CIRCI_API_URL=http://localhost:3000 CIRCI_TOKEN=circi_... CIRCI_BRANCH=main pnpm test:visual
```

The plugin is configured with `wait: true`, so the run exits 1 while the build has changes that need review (the first build always does): approve it in the dashboard and the next run on the same code exits 0. `CIRCI_COMMIT` / `CIRCI_BRANCH` override what is read from git, as for `circi upload`. `e2e/test/platform/dogfood.browser.e2e.test.ts` does exactly this on a throwaway stack: upload, approve, upload again, expect `no_changes`.

Notes from making it stable: fixed viewport (1000x700), fonts from `@fontsource-variable/*` imported by the test file, and the plugin's own animation/caret stabilization. Previews outside any package need `react` and `@circi/ui` aliased (see `vitest.config.ts`).
