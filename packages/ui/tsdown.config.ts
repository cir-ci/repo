import { defineConfig } from 'tsdown'

import pkg from './package.json' with { type: 'json' }
import { circiTokensCss } from './tokens-css.ts'

// Everything the package depends on stays external: the consumer's bundler resolves it
// once, so there is a single React and a single Base UI.
const external = Object.keys(pkg.dependencies).map((name) => new RegExp(`^${name}(/.*)?$`))

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'browser',
  // One JS, one declaration file (`./Button.js` specifiers) and
  // one stylesheet per component. `css.inject` makes each compiled `*.module.js` import its own CSS,
  // so a consumer gets a component's styles by importing the component.
  unbundle: true,
  minify: true,
  sourcemap: true,
  clean: true,
  dts: true,
  deps: { neverBundle: [...external, /^react\/jsx-runtime$/] },
  plugins: [circiTokensCss()],
  css: { minify: true, inject: true },
})
