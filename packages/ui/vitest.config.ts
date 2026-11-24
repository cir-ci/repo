import ui from '@circi/vitest-config/vitest.ui.config.ts'
import type { ViteUserConfig } from 'vitest/config'

import { circiTokensCss } from './tokens-css.ts'

type Plugin = NonNullable<ViteUserConfig['plugins']>[number]
type CirciPlugin = (options: { name: string; wait: boolean; root: string }) => Plugin

// By a variable, so this package's typecheck (DOM types only) doesn't follow it into the plugin's and
// the CLI's Node code.
const circiVitest: string = '@circi/vitest'

function isCirciModule(module: unknown): module is { circi: CirciPlugin } {
  return (
    typeof module === 'object' &&
    module !== null &&
    'circi' in module &&
    typeof module.circi === 'function'
  )
}

export default ui(import.meta.dirname, {
  // Fills the token variables into global.css, as the real build does.
  plugins: [circiTokensCss()],
  // Only the visual run (`pnpm test:visual`, which builds @circi/vitest first) loads the plugin.
  visual: async (root) => {
    const module: unknown = await import(circiVitest)
    if (!isCirciModule(module)) throw new Error('@circi/vitest has no `circi` export: is it built?')
    return module.circi({ name: 'ui-chromium', wait: true, root })
  },
})
