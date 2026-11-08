# design-sync notes: @circi/ui

- Source is `packages/ui` (the design system as code); `apps/web` consumes it. The sync entry is the built `packages/ui/dist/index.js`; run `pnpm --filter @circi/ui build` first (`buildCmd`).
- `packages/ui/package.json` needs top-level `types` and `main`, and `src/index.ts` must export with `.js` specifiers: the converter reads `dist/index.d.ts` and cannot follow `.ts`/`.tsx` extensions in declarations.
- Run the converter with `--node-modules <repo>/packages/ui/node_modules --entry ./packages/ui/dist/index.js`.
- Components are Base UI parts styled with CSS modules. tsdown (`unbundle`, `css.inject`) emits one `dist/<Name>.css` per component, imported by its compiled `<Name>.module.js`, plus `dist/global.css` (tokens) imported by `index.js`; the converter collects them while bundling into `_ds_bundle.css` (no config needed; checked 2026-11-08: 71 components). Class names are Lightning CSS's default hashes, so previews must not target them. `cfg.provider` is `CirciTheme`; it owns the colour scheme itself (own scheme manager, no CSS-in-JS runtime).
- Fonts (Inter, JetBrains Mono variable) come from `apps/web/node_modules/@fontsource-variable/*` through `cfg.extraFonts`.
- Card sizes live in `cfg.overrides` (`viewport`, `cardMode`): default 4:3 cells leave these small components in a sea of black. Preview content sits ~30px below the cell's top, so heights include that.
- `AppFrame` previews pass `minHeight={360}`: the frame defaults to `100vh`.
- Playwright + chromium live in `.ds-sync/` (gitignored); reinstall with `cd .ds-sync && npm i playwright && npx playwright install chromium`.

## Re-sync risks
- PanelHeader previews draw their action buttons with tokens because `Button` is not part of `@circi/ui` yet.
- Tokens are CSS variables since the light scheme (2026-11-05); previews that need a literal colour (the Palette card) read `palettes.dark`. The `Light` card pins its subtree with `data-circi-color-scheme`.
- Grades were by eye on 2026-11-05 and not reviewed by a human in `.review.html`.
- The conventions header names token keys (`tokens.surface.*`, `tokens.state.*`, ...); a rename in `packages/ui/src/theme.ts` silently stales it: re-validate names against the bundle.
- 2026-11-05 resync (local build, validate, capture): all stages pass, 56 components. Icon wrappers (`*Icon`) have no previews yet ("floor card"); `ConfirmDialog` shows only its open state ("thin"); `Menu` shows only closed. Nothing was uploaded to the design project, and the grades were not reviewed by a person.
