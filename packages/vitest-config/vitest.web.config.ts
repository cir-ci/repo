import { realpathSync } from 'node:fs'
import { join } from 'node:path'

import type { ViteUserConfig } from 'vitest/config'

import { baseUiDeps, components, iconDeps, reactDeps, sourceKeyed, viaUi } from './browser.ts'
import node from './vitest.node.config.ts'

/**
 * The dashboard (`apps/web`): its render-free logic tests in Node, and its components in headless
 * Chromium (`web-browser`). `plugins` are the package's own: @circi/ui's token plugin, which fills
 * the token variables into the design system's CSS as the real build does.
 */
export default function web(root: string, { plugins }: { plugins: ViteUserConfig['plugins'] }) {
  // The design system's folder, through the dashboard's link to it.
  const uiRoot = realpathSync(join(root, 'node_modules/@circi/ui'))
  return node(root, {
    plugins,
    projects: [
      // The design system as one pre-bundled module (its CSS modules stay separate imports), with
      // the subpaths the dashboard imports in the same bundle so they share its modules.
      sourceKeyed(
        components(
          'web-browser',
          root,
          [
            ...viaUi([...baseUiDeps, ...iconDeps]),
            ...reactDeps,
            '@tanstack/react-query',
            '@tanstack/react-router',
            '@tanstack/react-virtual',
            'better-auth/client/plugins',
            'better-auth/react',
            'react-dom/client',
            'zustand',
            'zustand/middleware',
          ],
          // Resets fetch, mocks, timers, stores and storage after each test (relative to apps/web).
          ['test/support/setup.ts'],
        ),
        ['@circi/ui', '@circi/ui/theme', '@circi/ui/project-icons', '@circi/ui/lucide-names'],
        [join(uiRoot, 'src')],
      ),
    ],
  })
}
