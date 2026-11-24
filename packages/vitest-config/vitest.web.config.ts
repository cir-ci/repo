import type { ViteUserConfig } from 'vitest/config'

import { baseUiDeps, components, iconDeps, reactDeps, viaUi } from './browser.ts'
import node from './vitest.node.config.ts'

/**
 * The dashboard (`apps/web`): its render-free logic tests in Node, and its components in headless
 * Chromium (`web-browser`). `plugins` are the package's own: @circi/ui's token plugin, which fills
 * the token variables into the design system's CSS as the real build does.
 */
export default function web(root: string, { plugins }: { plugins: ViteUserConfig['plugins'] }) {
  return node(root, {
    plugins,
    projects: [
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
    ],
  })
}
