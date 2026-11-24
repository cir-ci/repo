import type { TestProjectInlineConfiguration } from 'vitest/config'

/**
 * A package's slow tests against the real tool it plugs into (`*.integration.test.ts`): a real
 * Storybook build, real Cypress, a nested Vitest in Chromium. A project of their own, so they don't
 * hold up the package's Node tests. No database.
 */
export function integration(
  name: string,
  include: string[],
  timeouts: { testTimeout: number; hookTimeout: number },
): TestProjectInlineConfiguration {
  return { extends: true, test: { name, include, ...timeouts } }
}

/** Where a package keeps its slow tests: run by `integration`, never by the Node project. */
export const INTEGRATION_TESTS = 'test/**/*.integration.test.ts'
