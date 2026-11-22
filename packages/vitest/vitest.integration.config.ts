import { defineConfig } from 'vitest/config'

/**
 * The `circi()` plugin against a real nested Vitest in headless Chromium (about 15 s): its own
 * run (`pnpm test:vitest`, the turbo task `//#test:vitest`), so it is not on the Node tests'
 * critical path. The rest of this package's tests are in `test/`, part of the Node project.
 */
export default defineConfig({
  test: {
    name: 'vitest-plugin',
    root: import.meta.dirname,
    include: ['integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
