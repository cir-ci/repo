# @circi/vitest

The [CirCI](https://circi.dev) plugin for Vitest browser mode. Your tests keep Vitest's own `toMatchScreenshot`; the plugin writes each screenshot to `.circi/screenshots/vitest/<test file>/<name>.png` and uploads them to your CirCI server when the run ends. CirCI compares and reviews them.

```ts
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

```ts
await expect.element(page.getByRole('button')).toMatchScreenshot('button/primary')
```

By default (`local: false`) nothing is compared or stored locally and a test never fails on pixels. With `local: true`, Vitest's normal comparison also runs and the screenshots are uploaded as well.

`circiScreenshot` was removed in 0.3.0; see the [migration guide](https://circi.dev/ci/vitest/#migrating-from-circiscreenshot).

Tested with Vitest 5.1 (Chromium through Playwright); needs Node 22 or later.

- [Vitest plugin documentation](https://circi.dev/ci/vitest/)
- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/vitest/CHANGELOG.md)

Licensed under the GNU GPL v3.
