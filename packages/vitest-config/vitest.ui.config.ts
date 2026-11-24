import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import type { TestProjectInlineConfiguration, ViteUserConfig } from 'vitest/config'

import { baseUiDeps, chromium, components, iconDeps, reactDeps, viaUi } from './browser.ts'
import { browserEnv } from './no-netlink.ts'
import node from './vitest.node.config.ts'

type Plugin = NonNullable<ViteUserConfig['plugins']>[number]

export interface UiOptions {
  /** The package's own plugins: its token plugin, which fills the token variables into its CSS. */
  plugins: ViteUserConfig['plugins']
  /**
   * The visual run (`pnpm test:visual`, VISUAL=1): the `circi()` plugin of the built @circi/vitest,
   * loaded only then, so the other runs need no build of it.
   */
  visual?: () => Promise<Plugin>
}

/**
 * The design system's visual tests: every @circi/ui component in both color schemes, captured by
 * `toMatchScreenshot` under the @circi/vitest plugin. Rooted at the repository (the screenshots,
 * named by their path from there, go to its .circi), where nothing but @circi/ui is installed: React
 * and the dependencies resolve through it. A function: building the browser's environment compiles
 * the preload library on Linux, which only a visual run needs.
 */
function visualProject(uiRoot: string): TestProjectInlineConfiguration {
  const repoRoot = resolve(uiRoot, '../..')
  const uiRequire = createRequire(resolve(uiRoot, 'package.json'))
  // The end-to-end suite runs this beside its Docker stacks: on Linux the browser must not hear of
  // the host's network changes, or it aborts its module requests ("Failed to fetch dynamically
  // imported module"); see no-netlink.ts.
  const env = browserEnv()
  return {
    extends: true,
    root: repoRoot,
    oxc: { jsx: { runtime: 'automatic' } },
    resolve: {
      alias: [
        // The previews (packages/ui/visual/previews) import `@circi/ui` by name: the source.
        { find: /^@circi\/ui$/, replacement: resolve(uiRoot, 'src/index.ts') },
        ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].map((id) => ({
          find: new RegExp(`^${id}$`),
          replacement: uiRequire.resolve(id),
        })),
      ],
    },
    // `entries` starts the dependency scan from the test file and its previews, so the optimizer
    // knows every dependency before the browser asks for the first module: one found while the page
    // already runs is re-optimized, the page reloads, and its pending imports fail with "Failed to
    // fetch dynamically imported module".
    optimizeDeps: {
      include: viaUi([...baseUiDeps, ...iconDeps, 'react', 'react/jsx-dev-runtime']),
      entries: ['packages/ui/visual/**/*.tsx'],
    },
    test: {
      name: 'ui-visual',
      include: ['packages/ui/visual/**/*.visual.test.tsx'],
      // The test file's iframe is ready only once the whole design system and every preview are
      // transformed and loaded: Vitest gives it 60 s by default (read in the browser from the
      // config's env), and a loaded CI machine took longer ("The iframe … did not become ready
      // within 60000ms", so no test ran).
      env: { VITEST_BROWSER_IFRAME_TIMEOUT: '300000' },
      browser: {
        ...chromium(env),
        // The page connects to the runner only after Vite has optimized and served the whole design
        // system: a loaded CI machine (the end-to-end stacks beside it) takes well over the default
        // 60 s ("Failed to connect to the browser session").
        connectTimeout: 300_000,
      },
    },
  }
}

/**
 * `@circi/ui`: its logic tests in Node, its components in headless Chromium (`ui`), and, with
 * VISUAL=1, the visual run instead (`ui-visual`), whose captures go to .circi/screenshots/vitest and
 * are sent to CirCI when CIRCI_API_URL and CIRCI_TOKEN are set.
 */
export default async function ui(root: string, { plugins, visual }: UiOptions) {
  if (process.env['VISUAL']) {
    if (!visual) throw new Error('The visual run needs the `circi()` plugin (`visual`).')
    const config = node(root, { plugins: [plugins, await visual()] })
    return { ...config, test: { ...config.test, projects: [visualProject(root)] } }
  }
  return node(root, {
    plugins,
    projects: [
      // Fails a test on an unexpected console.error or unhandled rejection (relative to packages/ui).
      components('ui', root, [...baseUiDeps, ...iconDeps, ...reactDeps], ['test/setup.ts']),
    ],
  })
}
