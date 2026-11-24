import ui from '@circi/tsdown-config/tsdown.ui.ts'

import pkg from './package.json' with { type: 'json' }
import { circiTokensCss } from './tokens-css.ts'

// The build lives in @circi/tsdown-config (tsdown.ui.ts); this package hands it what is its own.
export default ui({ dependencies: pkg.dependencies, plugins: [circiTokensCss()] })
