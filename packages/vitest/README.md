# @circi/vitest

The [CirCI](https://circi.dev) plugin for Vitest browser mode: stable screenshots with `circiScreenshot`, and a reporter that uploads them to your CirCI server when the run ends.

```ts
import { CirciReporter } from '@circi/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { reporters: ['default', new CirciReporter({ name: 'vitest-chromium' })] },
})
```

Needs Vitest 4 or later and Node 22 or later.

- [Vitest plugin documentation](https://circi.dev/ci/vitest/)
- [Changelog](https://github.com/cir-ci/repo/blob/main/packages/vitest/CHANGELOG.md)

Licensed under the GNU GPL v3.
