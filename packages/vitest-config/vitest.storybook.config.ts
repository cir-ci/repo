import node from './vitest.node.config.ts'
import { INTEGRATION_TESTS, integration } from './vitest.slow.ts'

/**
 * `@circi/storybook`: its Node tests, and the CLI against a real Storybook 10 build (React and Vite),
 * screenshotted in headless Chromium, with only CirCI faked (`storybook`, slow: it builds Storybook).
 */
export default function storybook(root: string) {
  return node(root, {
    exclude: [INTEGRATION_TESTS, 'test/fixtures/**'],
    projects: [
      integration('storybook', [INTEGRATION_TESTS], { testTimeout: 240_000, hookTimeout: 300_000 }),
    ],
  })
}
