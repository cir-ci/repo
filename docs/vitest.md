# Vitest

`@circi/vitest` takes screenshots from Vitest browser mode that stay the same between runs, and uploads them to CirCI when the run ends.

> Status: the reporter, collection, shard mapping and screenshot naming are tested. Taking screenshots in a real browser through `circiScreenshot` has **not** been run against Playwright or WebDriver yet: try it on one test first.

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
import { circiScreenshot } from '@circi/vitest'
import { page } from 'vitest/browser'

it('primary button', async () => {
  render(<Button variant="primary">Save</Button>)
  await circiScreenshot(page, 'button/primary')
})
```

`circiScreenshot` turns CSS animation and transitions off, waits for fonts and two animation frames, then saves `.circi/screenshots/button/primary.png`. Set `CIRCI_API_URL` and `CIRCI_TOKEN` in CI; without them the reporter does nothing.

## Using `toMatchScreenshot`

Already using Vitest's `expect(...).toMatchScreenshot()`? Set `collectToMatchScreenshot: true` on the reporter and the pictures it keeps in `__screenshots__` folders are uploaded too (its `-actual` and `-diff` pictures are skipped). CirCI then does the comparing and review; keep or drop Vitest's own assertion as you prefer.

## One build per browser, and shards

Give each browser project its own reporter `name` (`vitest-chromium`, `vitest-firefox`) so each has its own baselines. `vitest --shard=2/4` is picked up automatically and uploaded as shard 2 of 4 of the same build.

## Options

`apiUrl`, `token` (default to the `CIRCI_*` variables), `name`, `dir`, `collectToMatchScreenshot`, `root`, `wait` (fail the run when changes need review), `strict` (fail the run when the upload fails; by default a failed upload never changes the test result).
