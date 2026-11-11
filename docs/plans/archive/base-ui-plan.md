# Plan: `@circi/ui` on Base UI instead of MUI

Status: **done** (2026-11-05, §8; built with tsdown since 2026-11-08, `docs/plans/archive/tsdown-plan.md`). All six steps are complete: spike, foundation, the rebuilt and
new components, every page migrated, and MUI and emotion removed (own colour-scheme manager in
`packages/ui/src/color-scheme.ts`; import rules enforced by `packages/services/test/layers.test.ts`).
Spike findings: `apps/web` aliases `@circi/ui` to its source (`vite build` otherwise resolves dist
without the compiled CSS); `generateScopedName` is a function in `packages/ui/css-modules.ts`;
popups use the `--circi-z-*` scale. Web JS went 819 kB → 755 kB after removing MUI; the largest
shared chunk is still over Vite's 250 kB warning (see `docs/plans/remaining-work.md`).

## 1. Why

- The design is our own: dense, hairlines, no shadows, 28px controls, 44px rows. MUI starts from
  Material Design, and each control we use means undoing Material (ripple, floating labels,
  elevation, spacing) in `theme.ts` overrides that grow with every control.
- Most of the design system is still to be built (buttons, fields, dialogs, menus, banners, empty
  states), so it is new code either way.
- Base UI (`@base-ui/react`, 1.9.0, stable, by the MUI project) gives the parts that are hard to get
  right (focus management, keyboard, ARIA, popup positioning) and no styling at all.
- Two earlier decisions make the switch cheap: `apps/web` will import only `@circi/ui`, so the
  switch never reaches the pages; and the tokens are already CSS variables, so any styling method
  can use them and light/dark keeps working.

## 2. What changes and what doesn't

| Stays | Changes |
| --- | --- |
| Component names and props of the 9 existing components (`AppFrame`, `NavItem`, `PanelHeader`, `ListRow`, `StatusIcon`, `StatusChip`, `SegmentedControl`, `Kbd`, `ColorSchemeControl`) | Their insides: MUI `Box`/`ButtonBase`/`sx` → plain elements or Base UI parts, styled with CSS |
| `tokens`, `palettes`, `COLOR_SCHEME_ATTRIBUTE`, `MODE_STORAGE_KEY` | Token variables move from MUI's `CssBaseline` overrides to a static `tokens.css` |
| Light/dark, system default, stored choice, no-flash script in `index.html` | MUI's scheme manager (`useColorScheme`) → a small one of our own, **at the end** (§5 step 5) |
| The page migration order in `refactor-plan.md` §4.2 | Each page is rebuilt on Base UI-based components, not themed MUI ones |
| design-sync | Static CSS (CSS modules compiled to `dist/styles.css`) instead of a CSS-in-JS runtime: the `[CSS_RUNTIME]` warning goes away |
| `@circi/ui` build: `tsc -b` | Vite library mode + `tsc --emitDeclarationOnly` (§3) |

## 3. Styling: CSS modules (decided)

Base UI marks state with data attributes (`data-open`, `data-pressed`, `data-disabled`,
`data-invalid`, …) and expects styling through plain CSS. We use **CSS modules**:

- One module per component next to it: `Button.tsx` + `Button.module.css`, imported as
  `import styles from './Button.module.css'`. States through Base UI's data attributes
  (`.root[data-disabled]`), variants through a data attribute set by the component
  (`.root[data-variant='danger']`), colours only through `var(--circi-…)` tokens.
- Readable, stable class names: `generateScopedName: 'circi-[name]__[local]'`
  (`circi-Button__root`), so the DOM, design-sync previews and the dogfood screenshots stay
  legible and don't change on every build.
- Global CSS is limited to one `global.css` (not a module): the token variables for both
  schemes (generated from `theme.ts`'s `tokenVariables`, so `theme.ts` stays the source), the base
  reset, the focus ring and the font stacks.
- **Build:** `tsc` can't process CSS modules, so `@circi/ui` builds with **Vite in library mode**
  (`dist/index.js` + one `dist/styles.css`) and `tsc --emitDeclarationOnly` for `dist/*.d.ts`
  (design-sync needs the `.d.ts`). A `src/css-modules.d.ts` declares `*.module.css` for the type
  check. `apps/web` keeps using the source condition (`@circi/source`) (source), so Vite handles the modules
  directly in dev and in the app build; `main.tsx` imports `@circi/ui/styles.css` only for the
  built package (dist).
- design-sync: the converter gets `dist/styles.css` (config entry checked in the spike).
- Tests: Vitest handles CSS modules itself; set `css.modules.generateScopedName` the same in
  `vitest.config.ts` so tests see the same class names.
- Layout inside pages: `Stack` (flex with `gap`, `direction`, `align`) and `Text` (the type scale:
  `body`, `small`, `title`, `heading`, `mono`; tones `secondary`, `tertiary`) in `@circi/ui`.
  Anything they can't express goes in the feature's own `*.module.css` in `apps/web` (question 3).
- Emotion goes away with MUI (§5 step 6): no CSS-in-JS runtime, smaller bundle.

## 4. Component map

`apps/web` today: 114 `Box`, 57 `Typography`, 41 `Button`, 38 `Alert`, 32 `Stack`, 26 `TextField`,
6 `Checkbox`, 5 `Skeleton`, 5 `MenuItem`, 4 `ToggleButton`, 2 `Dialog`, 1 each of `Menu`,
`IconButton`, `Avatar`, `CircularProgress`, `Slider`, `Collapse`; 182 `sx` props; 17 MUI icons
in 7 files.

| Used today (MUI) | Base UI part | `@circi/ui` component |
| --- | --- | --- |
| `Box`, `Stack`, `Paper` | — | `Stack`, `Surface` (panel/raised/overlay) |
| `Typography` | — | `Text`, `Heading` |
| `Button`, `IconButton` | `button` | `Button` (`primary`/`secondary`/`danger`/`ghost`), `IconButton` |
| `TextField` | `field`, `input` | `TextField` (label, description, error) |
| `TextField select` + `MenuItem` (create project, invite) | `select` | `Select` |
| `Checkbox`, `FormControlLabel`, `FormGroup` | `checkbox`, `checkbox-group`, `fieldset` | `Checkbox`, `CheckboxGroup` |
| `Dialog*` (create dialogs) | `dialog`, `alert-dialog` | `Dialog`, `ConfirmDialog` (destructive actions) |
| `Menu`, `MenuItem`, `Avatar` (user menu) | `menu`, `avatar` | `Menu`, `Avatar` |
| `ToggleButtonGroup` (diff modes) | `toggle-group` | `SegmentedControl` (existing, rebuilt) |
| `Slider` (swipe view) | `slider` | `Slider` |
| `Collapse` | `collapsible` | `Collapsible` |
| `Alert` | — (none) | `Banner` (`role="status"` or `"alert"`) |
| `Skeleton`, `CircularProgress` | `progress` (determinate only) | `Skeleton`, `Spinner` |
| `Link`, `createLink(MuiLink)` | — | `Link` (+ `RouterLink` via TanStack `createLink` in `apps/web`) |
| — (new) | `tooltip`, `toast`?, `tabs`? | `Tooltip`; toast/tabs only if the design asks |
| `ButtonBase` inside `NavItem`, `ListRow` | `button` / `use-render` | rebuilt, same props |
| 17 MUI icons | — | an icon set re-exported from `@circi/ui` (question 2) |

The announcer (`aria-live`), `Delayed` and the skip link move to `@circi/ui` as planned; they need
no Base UI part.

## 5. Steps

Each step is one or more commits with all checks green.

1. **Spike (gate).** On a branch: `Button`, `TextField` and `Dialog` on Base UI with CSS modules,
   used on one real page next to MUI. Check, and report back before going on:
   - the Vite library build of `@circi/ui` (`dist/index.js`, `dist/styles.css`, `.d.ts`), the
     source-condition path in `apps/web` (dev and build), Vitest, and design-sync's converter;
   - Base UI under Vitest browser mode (popups in portals, `getAnimations`, pointer events, `ResizeObserver`);
     add stubs to the web test setup if needed;
   - Base UI and MUI side by side: no CSS order or specificity clashes, focus and portals work;
   - bundle size before and after;
   - light and dark both look right in a browser.
2. **Foundation.** The Vite library build, `global.css` (token variables generated from
   `tokenVariables` so `theme.ts` stays the source), base reset (scoped so it doesn't fight MUI's `CssBaseline` while both run), focus
   ring, `Stack`, `Text`, `Heading`, `Surface`, `Link`, icons.
3. **Rebuild the 9 existing components** on CSS modules / Base UI with unchanged props. The existing tests
   pass unchanged, which is the proof; add one test file per component (refactor-plan §2.1).
   Re-run design-sync.
4. **New components** from §4, each with a test, a design-sync preview in both schemes, and
   provisional styling where the design is missing (refactor-plan §6), marked as provisional in
   its doc comment.
5. **Pages** (refactor-plan §4.2): shell, then Account → Members → Projects → Project → Project
   settings → Sites → Build review → Login/Setup/Site handoff. `layers.test.ts` holds an allowlist
   of files still importing `@mui/*`; it only shrinks.
6. **Remove MUI.** When the allowlist is empty: our own scheme manager replaces MUI's
   `ThemeProvider` in `CirciTheme` (same storage key and attribute, same `ColorSchemeControl`),
   delete `theme` (the MUI theme) and the MUI overrides, remove `@mui/*` and `@emotion/*` from the
   catalog. Update `PLAN.md` (stack line), `CLAUDE.md`, `.design-sync/conventions.md` and
   `NOTES.md`.

## 6. Tests

**Decided: no `@testing-library/*`.** Component tests use Vitest's own tools: browser mode
(`@vitest/browser`, Playwright provider, headless chromium) with `vitest-browser-react` to render
and `page.getByRole(...)` / `userEvent` from `vitest/browser` to query and interact. A real
browser also removes the happy-dom gaps for Base UI (portals, animations, pointer events), so
the risk in §7 shrinks. If browser mode can't run in CI or here, the fallback is happy-dom with
Vitest's own assertions, not Testing Library.

- Separate Vitest project for `packages/ui` component tests (browser); the `node` project is
  unchanged. Existing happy-dom/Testing Library tests (`apps/web/test`, `packages/ui/test`) keep
  running until their pages are migrated; each page's migration rewrites its tests, and
  `@testing-library/*` leaves the catalog with the last of them.
- Query by role and accessible name; popups are found through `page` (portals are fine in a
  real browser).
- Keyboard behaviour we rely on gets a test per component (Escape closes a dialog, arrows move
  in a menu or segmented control, Enter submits a field).
- Contrast tests keep running on `palettes`; the dogfood visual tests (refactor-plan §3.3) run in
  the same browser project, so one setup serves both.

## 7. Risks

- **Browser mode in CI and locally:** needs chromium (Playwright); the spike reports run time and whether `pnpm test` still works from the root.
- **Two styling systems at once** during the migration: temporarily larger bundle; CSS order
  issues are checked in the spike.
- **design-sync** may need config for a package stylesheet: checked in the spike.
- **Build change:** `@circi/ui` leaves the plain `tsc -b` path the other packages use (refactor-plan
  §2.1 rule 6 gets an exception for it); `pnpm build` and `typecheck` must call it explicitly.
- **Base UI moves fast** (1.x minors): pin it in the pnpm catalog and upgrade on purpose.
- **Losing MUI's ready-made parts:** none of what we use lacks a Base UI part except `Alert`,
  `Skeleton` and layout, which are small to build.

## 8. Decisions (2026-11-05)

1. **Styling:** CSS modules (§3).
2. **Icons:** Lucide (`lucide-react`), re-exported from `@circi/ui` so the app never imports it.
3. **Page CSS:** every page has its own `*.module.css` in `apps/web`, built around `@circi/ui`:
   components and tokens come from the design system, the page module only arranges them (grid,
   widths, spacing). No colours or type sizes outside tokens and `Text`.
4. **Missing designs:** build now to the provisional specs in `docs/design-gaps.md`; components
   built to them are marked `Provisional`.
5. **Order:** the spike (§5 step 1) runs first, before the test and file-layout steps of
   refactor-plan §5.
6. **Execution:** done by several Sonnet agents in parallel, each on an independent slice
   (separate files or packages), with the spike's gate reviewed before the rest starts.

Status: approved and carried out (see the status line at the top).
