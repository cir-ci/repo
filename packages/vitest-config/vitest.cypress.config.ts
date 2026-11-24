import node from './vitest.node.config.ts'
import { INTEGRATION_TESTS, integration } from './vitest.slow.ts'

/**
 * `@circi/cypress`: its Node tests, and the built package over real Cypress (headless Electron,
 * end-to-end and component testing) with only CirCI faked (`cypress`, slow: it starts Cypress).
 */
export default function cypress(root: string) {
  return node(root, {
    exclude: [INTEGRATION_TESTS, 'test/fixtures/**'],
    projects: [
      integration('cypress', [INTEGRATION_TESTS], { testTimeout: 300_000, hookTimeout: 300_000 }),
    ],
  })
}
