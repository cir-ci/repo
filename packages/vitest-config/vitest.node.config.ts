import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from 'vitest/config'

import { base, type BaseOptions, SETUP_NODE } from './shared.ts'

export interface NodeOptions extends BaseOptions {
  /**
   * Global setup files, absolute. The packages whose tests create a database (`createTestDb()`) pass
   * @circi/db's `template-db.ts`, which starts (or finds) the test Postgres server and its migrated template.
   */
  globalSetup?: string[]
  /** The package's Node tests, from its folder. */
  include?: string[]
  /** Test files of the package that aren't Node tests (another project runs them, or nothing does). */
  exclude?: string[]
  /** The package's other projects (component, integration or end-to-end tests). */
  projects?: TestProjectInlineConfiguration[]
  plugins?: ViteUserConfig['plugins']
}

/**
 * A package's Node tests (`test/**\/*.test.ts`). They share their modules between files
 * (`isolate: false`): loading the server, the database code and better-auth again for each file was
 * half the run's time. A file that mocks a module (`vi.mock`) can't share: its mock would stay in place
 * for the next file in the same worker, so those files run in `node-isolated`, each with its own
 * modules, found by reading them.
 */
export function nodeProjects(
  root: string,
  { globalSetup = [], include = ['test/**/*.test.ts'], exclude = [] }: NodeOptions = {},
): TestProjectInlineConfiguration[] {
  const mocking = globSync(include, { cwd: root, exclude }).filter((file) =>
    /\bvi\.mock\(/.test(readFileSync(resolve(root, file), 'utf8')),
  )
  const project = (
    name: string,
    test: { isolate: boolean; include: string[]; exclude: string[] },
  ): TestProjectInlineConfiguration => ({
    extends: true,
    // Pins TZ and restores mocks per file; with `globalSetup`, the test Postgres server for every createTestDb().
    test: { name, globalSetup, setupFiles: [SETUP_NODE], ...test },
  })
  return [
    project('node', { isolate: false, include, exclude: [...exclude, ...mocking] }),
    ...(mocking.length > 0
      ? [project('node-isolated', { isolate: true, include: mocking, exclude: [] })]
      : []),
  ]
}

/** The config of a package that has Node tests, and maybe other projects beside them. */
export default function node(root: string, options: NodeOptions = {}) {
  const config = base(root, options)
  return defineConfig({
    ...config,
    plugins: options.plugins ?? [],
    test: {
      ...config.test,
      projects: [...nodeProjects(root, options), ...(options.projects ?? [])],
    },
  })
}
