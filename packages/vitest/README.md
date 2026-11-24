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

To host Vitest's HTML report next to the screenshots, so reviewers can open the run's results, set `site`:

```ts
circi({ name: 'vitest-chromium', site: true })
```

The plugin adds Vitest's `html` reporter itself when `@vitest/ui` is installed (otherwise add `reporters: ['default', 'html']`). The report, the folder the `html` reporter writes (`.vitest`, or its `outputDir`), is uploaded after the screenshots, as a site named `vitest-report` (`site: { name }` renames it), and only when the screenshots were, from the first shard of a sharded run. `site: { dir: 'report' }` hosts a folder of your own instead. If the report isn't there, one line says so and the run is unaffected; a failed site upload only fails the run with `strict`.

`circiScreenshot` was removed in 0.3.0; see the [migration guide](https://circi.dev/ci/vitest/#migrating-from-circiscreenshot).

Tested with Vitest 5.1 (Chromium through Playwright); needs Node 22 or later.

- [Vitest plugin documentation](https://circi.dev/ci/vitest/)
- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/vitest/CHANGELOG.md)

Licensed under the [MIT License](LICENSE), so you can add it to any project. The CirCI server it talks to is GPL-3.0-only.
