import node from './vitest.node.config.ts'
import { integration } from './vitest.slow.ts'

/**
 * `@circi/vitest`: its Node tests, and the built `circi()` plugin against a real nested Vitest in
 * headless Chromium (`vitest-plugin`, about 15 s), kept in `integration/`.
 */
export default function vitestPlugin(root: string) {
  return node(root, {
    exclude: ['test/fixtures/**'],
    projects: [
      integration('vitest-plugin', ['integration/**/*.test.ts'], {
        testTimeout: 30_000,
        hookTimeout: 60_000,
      }),
    ],
  })
}
