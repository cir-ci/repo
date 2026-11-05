import { defineConfig } from 'vitest/config'

/**
 * Two kinds of test: the server-side packages and apps run in Node; the web app's run in a
 * simulated browser (happy-dom) so components can render.
 */
export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['apps/{server,worker}/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
        },
      },
      {
        extends: true,
        oxc: { jsx: { runtime: 'automatic' } },
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
