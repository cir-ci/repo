# Visual tests of the design system

CirCI screenshots its own design system with its Vitest plugin, `@circi/vitest`: `packages/ui/visual/ui.visual.test.tsx` renders every component's case (the `packages/ui/visual/previews` files, plus `packages/ui/visual/cases.tsx` for Button, TextField, Dialog, ColorSchemeControl and the icons) in light and dark and calls `toMatchScreenshot('<component>/<case>/<scheme>')`. The plugin is in the root `vitest.config.ts`, and only with `VISUAL=1`. The project `ui-visual` exists only when `VISUAL=1`, so `pnpm test` never takes them.

```sh
pnpm test:visual                    # no CIRCI_* variables: pictures are saved to .circi/screenshots, the run passes
```

To upload to a local CirCI (a dev stack, or any server you can reach), create a project, copy its CI token and:

```sh
CIRCI_API_URL=http://localhost:3000 CIRCI_TOKEN=circi_... CIRCI_BRANCH=main pnpm test:visual
```

The plugin is configured with `wait: true`, so the run exits 1 while the build has changes that need review (the first build always does): approve it in the dashboard and the next run on the same code exits 0. `CIRCI_COMMIT` / `CIRCI_BRANCH` override what is read from git, as for `circi upload`. `e2e/test/platform/dogfood.browser.e2e.test.ts` does exactly this on a throwaway stack: upload, approve, upload again, expect `no_changes`.

Notes from making it stable: fixed viewport (1000x700), fonts from `@fontsource-variable/*` imported by the test file, and the plugin's own animation/caret stabilization. Previews outside any package need `react` and `@circi/ui` aliased (see `vitest.config.ts`).

How the plugin works is on the website: [Vitest plugin](https://circi.dev/ci/vitest/).
