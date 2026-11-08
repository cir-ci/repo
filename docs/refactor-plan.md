# Refactor plan: file layout, tests, and the new UI

Status: agreed 2026-11-05 (decisions in §6). Done so far (2026-11-05, 835 tests, all checks green):
the light colour scheme (§4.0); the Base UI spike and the first wave of `@circi/ui` (foundation,
the 9 rebuilt components, 19 new components, all Provisional where the design is a gap); back-end
layout moves and test moves/renames in every package (§2.2 except `apps/web`, §3.1); `@circi/api`
and `db/queries` split (queries are `{builds,projects,files}.ts`, there was nothing for orgs/sites);
seeders in `@circi/testing`; the missing test files of §3.2 for server, worker, cli, auth, config and
db; Testing Library removed from every test and from the dependencies. Left: `apps/web` layout
(§2.3), the shell and the page-by-page migration (§4.2 steps 2 to 5), removing MUI (step 6), tests
still hand-inserting rows that should use the new seeders, `apps/web` test gaps (§3.2 web).
The **UI page work (§4.2 onward) is blocked on the design gaps in §6**; the layout and test work
(§2, §3) is not.

## 1. Where we are

- 17 workspaces. The back end is close to the conventions in `CLAUDE.md`; the gaps are naming and
  test placement, not architecture.
- `@circi/ui` (new, not yet committed) holds the new design system:
  `CirciTheme`, `AppFrame`, `NavItem`, `PanelHeader`, `ListRow`, `StatusIcon`, `StatusChip`,
  `SegmentedControl`, `Kbd`, `tokens`. It is synced to the design tool through `.design-sync/`.
- `apps/web` has only taken the new **theme** (now light and dark). Its layout is still the old Primer-style one: a
  top header (`router.tsx` `AppFrame`), `primitives/` (`PageLayout`, `PageHeader`, `NavList`,
  `Rows`, `labels`, `Blankslate`, `feedback`) and `components.tsx`. 15 of the 29 feature `.tsx`
  files import from `primitives/`; all 29 import `@mui/material` directly.
- Tests: 578, all green. Coverage by file count: server 18 test files / 49 source files, web 3 / 50,
  worker 3 / 7, cli 2 / 8, auth 5 / 20.

## 2. File layout: the target, everywhere

### 2.1 Rules (to add to `CLAUDE.md` once agreed)

1. **Names.** `kebab-case.ts` for modules, `PascalCase.tsx` for a file whose main export is one
   component. One exported component per `.tsx` file (small private helpers may stay).
2. **Public surface.** Every package has `src/index.ts` with explicit named exports. No deep
   imports into another package's `src/`.
3. **Folders by concept, not by kind,** once a folder would hold more than ~6 files or two
   unrelated concerns (`db/repositories/` is the model; `server/src` root is the counter-example).
4. **Tests mirror sources:** `src/a/b.ts` → `test/a/b.test.ts`. A test that spans modules
   (end-to-end, lifecycle, layering) lives in `test/` root and is named for the behaviour
   (`e2e.test.ts`, `layers.test.ts`).
5. **Test-only code** (fakes, fixtures, helpers) lives in `test/support/`; fakes are named
   `fake-<service>.ts`.
6. **One build path.** Every package builds with `tsc -b` from `tsconfig.build.json` and is type
   checked by the root `typecheck`; no package gets its own special case.

### 2.2 Per workspace

| Workspace | Change | Size |
| --- | --- | --- |
| `apps/server` | Move the lifecycle files (`runtime`, `services`, `startup`, `server-options`, `shutdown`) into `src/lifecycle/`; keep `main.ts` and `contract-check.ts` at the root. Move `http/{deps,errors,pages,presenters,streams,validation}.ts` into `http/lib/`. Update the `CLAUDE.md` layout line. | S |
| `apps/worker` | Fine. Only tests move (§3). | XS |
| `apps/web` | Largest change; see §2.3. | L |
| `packages/api` | **Decided: now.** Split the 211-line `index.ts` into one file per namespace (`build.ts`, `project.ts`, `org.ts`, …) re-exported from `index.ts`. Wire types stay types-only. | S |
| `packages/auth` | `sso.ts` vs `plugins/sso.ts` and `admin.ts`/`accounts.ts`/`setup.ts` are ambiguous at the root. Move the admin operations to `src/operations/{admin,accounts,setup}.ts`, the SSO helpers to `src/sso/` beside `trusted-issuers.ts`. Keep `hooks/` and `plugins/`. | S |
| `packages/cli` | Fine. `index.ts` (library surface) vs `main.ts` (bin) is right; add a comment saying so. | XS |
| `packages/config`, `core`, `diff`, `storage`, `vitest` | Fine. Tests only (§3). | XS |
| `packages/db` | **Decided: now.** Split `queries/dashboard.ts` (309 lines) per resource to match `@circi/api`: `queries/{builds,projects,orgs,sites}.ts`. `contract-check.ts` follows. | S |
| `packages/providers` | Fine for one host. When GitLab/Gitea land: `src/github/{client,checks,render}.ts`, one folder per host. Not now. | — |
| `packages/services` | Fine. `test/events.test.ts` tests `completeBuild`/`reviewBuild` outbox behaviour: rename to `outbox.test.ts`. | XS |
| `packages/sites` | Fine. Tests only (§3). | XS |
| `packages/testing` | Add seeders for builds, screenshots, sites, webhooks (9 test files insert rows by hand today). | S |
| `packages/ui` | Split `frame.tsx` and `primitives.tsx` into one file per component (`AppFrame.tsx`, `NavItem.tsx`, `PanelHeader.tsx`, `Kbd.tsx`, `ListRow.tsx`, `SegmentedControl.tsx`, `StatusChip.tsx`), matching the per-component layout design-sync already produces. Bring it into the root `tsconfig.build.json` instead of `tsc -b packages/ui` + an exclude (keep the `.js` specifiers design-sync needs). | S |

### 2.3 `apps/web`

```
src/
  main.tsx
  app/            router.tsx (root route + tree only), Shell.tsx (sidebar frame), providers.tsx,
                  NotFound.tsx
  lib/            http.ts, auth-client.ts, router-link.ts (RouterLink)
  features/<f>/   api.ts, routes.ts, *Page.tsx, one component per file
  features/builds/build-status.ts   buildState() → @circi/ui `Status`, out of components.tsx
```

- Delete `primitives/`, `components.tsx` and `theme.ts` once nothing imports them (§4). What is
  still needed moves either into `@circi/ui` (generic) or into the feature that uses it.
- Every feature declares its routes in `features/<f>/routes.ts` (only `builds/route.ts` does
  today); `app/router.tsx` only assembles them. `router.tsx` is 278 lines now.
- Feedback infrastructure (`AnnouncerProvider`, `useAnnounce`, `Delayed`, the skip link) moves to
  `@circi/ui`: with the MUI boundary below, the app can't build it itself.

## 3. Tests

### 3.1 Moves and renames (no behaviour change)

| From | To |
| --- | --- |
| `apps/server/test/routes/{dashboard,domains,org-auth,org-sso,settings,onboarding,sites}.test.ts` | `test/http/routes/dashboard/<file>.test.ts`, matching `src/http/routes/dashboard/` (split `dashboard.test.ts` by its `describe` blocks: sign-in, isolation, API, web app, reviewing) |
| `apps/server/test/routes/{argos,v1,health,github-webhook,…}.test.ts` | `test/http/routes/…` |
| `apps/server/test/{helpers,fake-idp}.ts`, `packages/sites/test/tar-helper.ts` | `test/support/` |
| `apps/worker/test/*.test.ts` | `test/jobs/*.test.ts` |
| `apps/web/test/components.test.tsx` | split into `test/features/builds/build-status.test.ts` and the `@circi/ui` tests of whatever replaces `Rows`/`ErrorState` |
| `packages/auth/test/hooks.test.ts` | `test/hooks/{user-create,account-create}.test.ts` |
| `packages/sites/test/sites.test.ts`, `config/test/config.test.ts`, `diff/test/diff.test.ts`, `vitest/test/vitest.test.ts` | one file per source module they cover |
| `packages/ui/test/ui.test.tsx` | one file per component |

### 3.2 Gaps to fill (each item is a missing test file by the mirror rule; check before writing that it isn't already covered elsewhere)

- **web:** `api.ts` of `projects`, `members`, `sites`, `instance`, `auth`; `auth/login-helpers.ts`.
  Add `test/support/render.tsx`: `renderPage()` wrapping `CirciTheme`, a fresh `QueryClient`,
  and a memory-history router.
- **server:** `http/hooks/{session,same-origin,project-token}`, `cli/admin` storage commands.
- **worker:** `lib/{concurrency,files}`, `runner.ts`.
- **cli:** `upload.ts`, `site.ts`, `api.ts` against a fake server (`test/support/fake-circi.ts`).
- **db:** repositories without a test: `auth-settings`, `domains`, `git`, `retention`,
  `screenshots`, `sites`, `users`.
- **auth:** the three `plugins/` (today only reached through server route tests).

### 3.3 Rules

- **Decided: no `@testing-library/*`** in new tests; component tests use Vitest browser mode with
  `vitest-browser-react` (see `docs/base-ui-plan.md` §6). The current happy-dom tests are rewritten
  as their pages migrate (§3.2's `renderPage()` helper becomes a browser-mode equivalent).

- Node tests: real migrations on PGlite through `@circi/testing`; seed with its seeders, not raw
  inserts (except inside `packages/db/test`).
- Web tests: logic in `api.ts`/`lib/` tested without rendering; component tests render through
  `test/support/render.tsx`, query by role and accessible name (the design system's status
  icons have labels for this).
- **Decided:** `apps/web` imports `@circi/ui` only, never `@mui/material` or
  `@mui/icons-material`. Extend `packages/services/test/layers.test.ts` to enforce it once §4 is
  done; until then it lists the files still allowed to, and the list only shrinks.
- **Decided, dogfood:** screenshot each `@circi/ui` component's preview, in both schemes, with
  `@circi/vitest` in browser mode and upload to a local CirCI. This is also the first real check
  of Vitest browser mode, which has never been verified.

## 4. UI/UX migration (§4.2 onward blocked on §6)

### 4.0 Light scheme (done, 2026-11-05)

- `palettes.light` / `palettes.dark` in `packages/ui/src/theme.ts`; `tokens` are now CSS
  variables (`var(--circi-surface-panel)`) defined for both, so inline styles follow the scheme.
- MUI runs with CSS variables and both colour schemes; the attribute
  `data-circi-color-scheme` on `<html>` picks one. It follows the system until the viewer
  chooses with `ColorSchemeControl` (stored as `circi-color-mode`). `apps/web/index.html` sets
  the attribute before the first paint. `<CirciTheme mode="light">` pins a scheme.
- `packages/ui/test/theme.test.ts` checks WCAG contrast for every text and state token on every
  surface in both schemes. It caught dark `text.tertiary` (#8c817c) at 4.4:1 on menus; it is
  now #998e89.
- Not done: the light scheme has not been looked at in a browser, only on the contrast test,
  and nothing in the app shows `ColorSchemeControl` yet (it goes in the user menu in §4.2 step 2).

### 4.1 Old to new

| Old (`apps/web`) | New (`@circi/ui`) | Gap |
| --- | --- | --- |
| Top header in `router.tsx` + `PageLayout` | `AppFrame` (sidebar + one panel) | Sidebar contents undefined |
| `PageHeader`, `ParentLinkContent` | `PanelHeader` (breadcrumb left, actions right) | Breadcrumb component |
| `Rows` (`Row`, `Section`) | `ListRow` | Section heading, settings row with a control |
| `NavList` (build review screenshot list) | `ListRow`? | Build review layout |
| `labels`: `StateLabel`, `ToneText`, 5 tones | `StatusIcon` / `StatusChip`, 5 statuses | Diff statuses don't map 1:1 |
| `labels`: `BranchName`, `CommitSha` | `monoFont` by hand | A `Mono`/`Ref` component |
| `Blankslate` | — | Empty state |
| `feedback`: `ListSkeleton`, `Delayed`, announcer | — | Loading state |
| `ErrorState` (`components.tsx`) | — | Error / not-found state |
| DiffViewer mode toggle (`ToggleButton`) | `SegmentedControl` | — |
| Keyboard hints (j/k/a/r) | `Kbd` | Shortcut overlay |
| MUI `Button`, `TextField`, `Alert`, `Dialog`, `Menu`, `Checkbox`, `Avatar` used directly | themed MUI only | Not in the design system (PanelHeader previews hard-code button hex) |

### 4.2 Order

1. **Fill `@circi/ui`** with the gap components once designed: `Button` (and `IconButton`),
   `TextField`/`Select`/`Checkbox` field with label, help and error, `Banner`, `Dialog`, `Menu`,
   `EmptyState`, `Skeleton`/`ListSkeleton`, `Breadcrumbs`, `SectionHeader`, `Ref` (mono, copyable),
   and wrappers for every MUI control the app uses, plus the icons it needs (MUI boundary).
   Each with a test and a design-sync preview in both schemes.
2. **Shell:** replace the header frame with `AppFrame` + sidebar (org switcher, nav, project
   list, user menu). Every page renders inside it unchanged; ship.
3. **Pages, one commit each (decided),** simplest first so the patterns settle before the hard screen:
   Account → Members → Projects list → Project (builds list) → Project settings → Sites →
   Build review. Login, Setup and Site handoff (outside the shell) last.
4. Delete `primitives/`, `components.tsx`, `theme.ts`; add the import rule to `layers.test.ts`.
5. Re-verify in Chrome (setup, project, build, approve, settings, members, account were verified
   on the old UI) and re-run design-sync.

## 5. Sequencing

Each step is one commit with all checks green.

1. Test moves/renames (§3.1) — mechanical, no review risk.
2. Back-end layout moves (§2.2 except `ui`, `web`).
3. `@circi/testing` seeders, then the test gaps (§3.2), package by package.
4. `apps/web` layout (§2.3) without visual change.
5. `packages/ui` split + build path.
6. Dogfood: `@circi/ui` previews through `@circi/vitest` browser mode (§3.3).
7. UI migration (§4.2), once the design gaps below are filled.

## 6. Questions and missing design information

### Decisions (2026-11-05)

1. **MUI boundary:** strict. `apps/web` imports only `@circi/ui`; a test enforces it.
2. **`packages/ui`:** no other session works in the repo; the split goes ahead in step 5.
3. **Migration:** page by page; the shell lands first.
4. **Theme:** light and dark (dark is the default). Light scheme built (§4.0).
5. **Split `@circi/api` and `db/queries/dashboard.ts` per resource:** now (step 2).
6. **Dogfooding with `@circi/vitest` browser mode:** yes (step 6).

Decided: **build `@circi/ui` on Base UI (`@base-ui/react`, 1.9) instead of MUI**, styled with CSS
modules, icons from Lucide; full plan in `docs/base-ui-plan.md`, provisional designs for the gaps
in `docs/design-gaps.md`. The Base UI spike runs before step 1 of §5. Base UI is unstyled, so it imposes no Material look, and every gap component in §4.2 step 1 is
new code anyway. The MUI boundary (decision 1) keeps the switch inside `@circi/ui`, and the tokens
are already CSS variables. Swap one component at a time; `@mui/material` leaves the repo when the
last page stops using it.

Still open: whether moving ~40 test files is fine (`git log --follow` still works); assumed yes.

### Missing design information

Provisional specs for each item below: `docs/design-gaps.md`.

Without these the migration either invents design or stalls at step 4.2.1.

1. **Buttons:** primary / secondary / danger / ghost, icon buttons, sizes, loading state.
2. **Forms:** text field, select, checkbox, radio, switch; label placement, help text, error
   text; the layout of a settings page (label column vs stacked).
3. **Feedback:** banners (invitation, address change), inline errors, toasts or not, destructive
   confirmations (delete project/webhook/member).
4. **Overlays:** dialog (create project/org), menu (user menu, row actions), tooltip.
5. **Empty, loading and error states**, including the 404 page.
6. **Sidebar content:** org switcher, project list (all? pinned? recent?), where the user menu
   and account live, what the sidebar shows inside a project. Mobile: below 820px the sidebar
   stacks above the panel; is that the intended phone design, or a drawer?
7. **Build review screen** (the main screen): layout of screenshot list vs viewer, grouping
   (Changed / Added / Removed / Unchanged / Flaky), viewer toolbar (mode, zoom, ignore regions),
   where approve/reject sit, keyboard shortcut help.
8. **Status mapping.** The 5 statuses cover builds roughly, but how do these look:
   build `uploading`, `expired`, `error`, orphan build, `no changes`; screenshot `added`,
   `removed`, `unchanged`, `flaky`, `failed`; review `pending`?
9. **Tables:** members (with a role select), webhooks, sites, CI token. `ListRow` or a table?
10. **Screens outside the frame:** login, first-run setup, site sign-in handoff.
11. **Typography scale** above 13px UI text: page titles, section headings, numbers.
12. **Icons:** keep MUI outlined icons? Size and stroke rules beside `StatusIcon`.
13. **Interaction states:** focus ring, hover, selected, disabled; motion (if any).
14. **The light scheme itself:** the palette is derived (same hues, darkened accent and state
    colours for contrast), not designed. It needs a look, especially the chrome/panel contrast
    and the accent clay `#b4573f`.
15. **Logo and favicon** assets, in both schemes.
16. **Review:** design-sync grades were by eye, not reviewed by a person in `.review.html`. Who
    signs off the components before pages are built on them?
