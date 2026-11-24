import { defineConfig, type UserConfig } from 'tsdown'

/**
 * `@circi/ui` (packages/ui): the design system, one file per component. The package passes its own
 * `dependencies` (all kept external) and its token plugin, which fills the design tokens into the CSS.
 */
export default function ui({
  dependencies,
  plugins,
}: {
  dependencies: Record<string, string>
  plugins: NonNullable<UserConfig['plugins']>
}) {
  // Everything the package depends on stays external: the consumer's bundler resolves it
  // once, so there is a single React and a single Base UI.
  const external = Object.keys(dependencies).map((name) => new RegExp(`^${name}(/.*)?$`))

  return defineConfig({
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
    plugins,
    css: { minify: true, inject: true },
  })
}
