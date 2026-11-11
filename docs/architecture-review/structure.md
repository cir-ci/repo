# File-structure review: apps, packages, e2e

Read-only review of the working tree on 2026-11-09 (branch `main`, uncommitted edits by other agents ignored). Numbers come from `find`/`wc`/`grep` over `src` and `test` (without `node_modules`, `dist`). "Lines" = `wc -l`. Nothing was changed.

## 1. Summary (the 8 findings that matter)

1. **`apps/web/src/features/projects` is a junk drawer (50 files, flat)**: it holds project pages, the New-project dialog, the builds browser and its filters, webhooks, CI token, ignore regions, delete-project and appearance. 25 of the app's cross-feature imports point at `#features/projects/*`. `builds` (36 files, flat, 3 api files) and `settings` (24) are the same shape. Features that import each other in both directions: `integrations <-> instance`, `projects <-> builds` (via baselines/triage), `settings -> auth/members/projects/triage`.
2. **Every vertical slice is smeared across four server folders**: sites live in `http/routes/v1/sites.ts`, `http/routes/dashboard/{project-sites,site-handoff}.ts`, `http/sites/{serve,cookie}.ts`; GitHub in `http/lib/github-app.ts` + `routes/dashboard/github-app.ts`; integrations in `routes/dashboard/{integrations,integrations-generic,issue-trackers,github-app}.ts` + `routes/integration-webhook.ts`. `routes/dashboard/` has 34 flat files with prefix groups (`workspace-*` x5, `instance-*` x5, `project*` x3) that are really sub-folders.
3. **`integrations` and `providers` mirror each other file by file** (bitbucket, figma, github, gitlab, jira, linear, slack in both: 2008 + 2494 lines) and the catalog data sits in a third place (`core/src/integrations.ts`). One connector is edited in three packages. The boundary is defensible (SDK + registry vs raw API clients) but is not visible in the folder layout and is crossed by apps (server 13, worker 4 imports of `@circi/providers` bypass the registry).
4. **`@circi/core` mixes browser-safe and Node-only code behind one barrel**: 5 of 25 files import `node:` (`token`, `secrets`, `signed-state`, `webhook`, `webhook-url`), so the web app cannot use `@circi/core` and goes through 4 hand-maintained subpaths (`./slug`, `./issues`, `./integrations`, `./figma`; 5 deep imports in `apps/web`). `@circi/db`'s barrel is `export *` over 46 modules = 250 exported functions in one flat namespace.
5. **Type-check gap**: root `tsconfig.json` excludes `apps/web` and `packages/ui`; `apps/web/tsconfig.json` includes only `src` and `vite.config.ts`. So `apps/web/test/**` (26 files plus `support/`) is never type-checked by `pnpm typecheck` (ui tests are, through `packages/ui/tsconfig.json`). `apps/web/tsconfig.json` also repeats the base options instead of extending `tsconfig.base.json`.
6. **Package-level cycle in devDependencies**: `@circi/db -> @circi/testing -> @circi/db` (`db` devDep `testing`; `testing` dep `db`). Same shape for `auth`, `services`, `worker` (all devDep `testing`). No file-level cycle can survive (`import/no-cycle: error` in `.oxlintrc.json`), but `pnpm -r` ordering and `--filter ...` selection see a cycle.
7. **Cross-workspace relative imports** (the `#alias` rule is broken exactly where aliases cannot help): `apps/web/vite.config.ts` and root `vitest.config.ts` import `packages/ui/tokens-css.ts`, `apps/web/tsconfig.json` includes `../../packages/ui/src/css-modules.d.ts`, `apps/web/test/lib/project-appearance.test.ts` imports `../../../../packages/ui/src/project-icons.ts`, and root `vitest.config.ts` imports `packages/vitest/src/index.ts` and `e2e/src/timing-reporter.ts`. The icon list also exists twice (`core/src/project-appearance.ts` `PROJECT_ICON_NAMES` and `ui/src/project-icons.ts`), kept equal only by that test.
8. **Packages that are near-empty or single-file**: `@circi/diff` (1 file, 188 lines, one consumer: worker), `@circi/config` (one 485-line `index.ts` + 42-line `public-url.ts`), `@circi/sites` (502 lines, one consumer: server), `@circi/storage` (481 lines). `@circi/diff` and `@circi/sites` are candidates to merge; `config` should be split by concern inside the package, not removed.

## 2. Package dependency graph

From `package.json` (`dependencies` unless noted; `[dev]` = devDependencies) and cross-checked against actual `from '@circi/…'` imports (declared == used everywhere; no undeclared import found).

```
LAYER 0 (no @circi deps)   api  core  config  providers  storage  sites  diff  cli  ui
                            |     |                |         |        |      |    |    |
                            |     +-------+--------+         |        |      |    |    |
LAYER 1                     |     |       |                  |        |      |    |    |
  db            -> core     |     |       |                  |        |      |    |    |
  integrations  -> api, core, providers                       |        |      |    |    |
LAYER 2                                                       |        |      |    |    |
  services      -> core, db, integrations, storage            |        |      |    |    |
  auth          -> core, db                                   |        |      |    |    |
  testing       -> db         [db, auth, services, worker: devDep -> testing]  <== cycle db<->testing
LAYER 3
  worker        -> core, db, diff, integrations, providers, services, storage   [dev: testing]
LAYER 4
  server        -> (all devDependencies, bundled by tsdown) api auth cli config core db integrations
                   providers services sites storage testing worker
  web           -> api, core, ui
  e2e           -> core   [dev: api, providers]
dev tooling:  ui [dev] -> vitest -> [dev] cli ;  root [dev] -> ui
```

Cycles: **one package-level cycle**, `db <-> testing` (dev edge only). No runtime cycle. Notes:

- `server` lists every `@circi/*` as a devDependency (it is bundled), `worker` lists them as dependencies although it is also bundled into the server image: the two apps declare the same fact differently.
- `integrations -> api` is a type-only import (`Integration` in `public.ts`), the only place a domain package depends on the wire-type package; CLAUDE.md says "dependencies point downwards ... api depends on nothing", which holds, but the catalog read model should then live where its types live (see section 5.4).
- `config` has no consumer other than `server` (10 imports) and, via the bundle, nobody else. `worker` receives config values by argument. So `config` is an app-private module living in `packages/`.
- `sites` has no consumer other than `server` (4 files); `diff` none other than `worker` (1 file). Both are "app-private logic hosted as packages". They are not wrong (they keep `sharp`/`pixelmatch` out of the server graph, and make tests cheap), but they do not need a package boundary each.

## 3. `exports` / `imports` consistency

| Package | `exports` | `imports` (`#…`) | Remark |
|---|---|---|---|
| api, auth, config, db, diff, integrations, providers, services, sites, storage, testing, worker | string `"./src/index.ts"` | see below | consistent; no `@circi/source` condition (not needed, no dist) |
| core | `.` + `./figma`, `./slug`, `./integrations`, `./issues` | `#src/*` | 4 subpaths exist only because the barrel is not browser-safe; `./figma` has 0 deep importers (dead subpath); `index.ts` also re-exports the same modules, so each is reachable twice |
| cli, vitest, ui | conditional `@circi/source` / `types` / `default` (dist) | `#src/*` | the three published/built ones; `vitest` adds `./browser`; `ui` has no `exports` for `tokens-css.ts` or `css-modules.d.ts` which are then reached by relative path |
| server | none (app) | `#cli/* #http/* #lifecycle/* #test/*` | no `#src/*` (no root-level code except `contract-check.ts`, `main.ts`) |
| web | none | `#app/* #features/* #lib/* #test/*` | good: folder per alias |
| worker | `"./src/index.ts"` | `#jobs/* #lib/* #src/*` | `#lib` collides in name with web's `#lib` and server's `#http/lib`; harmless but confusing |
| e2e | none | `#fakes/* #src/*` | `#src` used 84 times, all in `test/` |
| api, testing | | **none** | `testing/src/seed/*` and `api/src/*` use `./` only; fine for api (flat), but `testing` has a `seed/` folder with no alias |

Gaps and inconsistencies:

- **Alias per folder is only honoured in web, server, worker, db and auth.** Everywhere else `#src/*` is the only alias, so `from '#src/x.ts'` is just `./x.ts` with extra steps in a flat folder (`core` 19 uses, `providers` 12, `integrations` 11, `services` 19, `storage` 2, `sites` 4, `diff` 1, `config` 2, `cli` 6). In flat packages `./x.ts` is what CLAUDE.md prescribes ("relative `./` stays for siblings"); `#src` in a flat folder is only needed from `test/`. Suggest: keep `#src/*` for tests only and say so in CLAUDE.md.
- **`db` has `#repositories/*` (18 uses) and `#schema/*` (51) but no `#queries/*`**, and 114 `#src/*` uses (types/client/errors, and tests importing `#src/repositories/...`). Mixed.
- **Only `packages/cli` has a relative `../` in `src`** (1) and 4 tests have one each (`server`, `web`, `worker`, `core`); everything else is clean. The real violations are the config-file climbs listed in finding 7.
- `ui`, `cli`, `vitest` use `main`/`types` fields plus `exports`; `ui` still has `main`/`types` (redundant with `exports`).
- Barrel sizes: `config` 485 (code, not a barrel), `diff` 188 (code), `core` 95, `providers` 87, `services` 80, `db` 62 (46 `export *`), `ui` 62, `auth` 33, `api` 29, `integrations` 26, `sites` 17, `storage` 18, `testing` 17, `vitest` 10, `cli` 6, `worker` 2.
- **Over-exporting**: `db` (`export *` everything, 250 functions, including internals that only another repository needs), `providers` (87-line barrel exposing every client, every error class and the GitHub manifest builders). Compare `integrations` (26 lines), which is the model.

## 4. Config duplication (tsconfig, vitest, oxlint, build)

- **tsconfig**: `tsconfig.base.json` is extended by `tsconfig.json`, `packages/{cli,vitest,ui}/tsconfig.json`, `e2e/tsconfig.json`. Each repeats the same four overrides (`composite:false`, `declaration:false`, `declarationMap:false`, `noEmit:true`): 5 copies. `apps/web/tsconfig.json` does **not** extend the base and re-states `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `customConditions` (lib/module differ legitimately). `packages/ui/tsconfig.previews.json` is a fifth project only for `.design-sync/previews`. Suggest `tsconfig.node.json` (base + the four noEmit overrides) and `tsconfig.dom.json` (dom lib, bundler, jsx) so each workspace config is `{extends, include}`.
- Typecheck commands: root `typecheck` runs four `tsc -p` invocations; `e2e`, `cli`, `vitest` configs exist but are not run on their own (root `tsconfig.json` includes their sources). `cli/tsconfig.json` and `vitest/tsconfig.json` are therefore unused by `pnpm typecheck` (they exist for tsdown's dts, check) and are byte-identical to each other.
- **vitest**: one 190-line root `vitest.config.ts` for every project. It hard-codes the Base UI part list (19 ids) and three `optimizeDeps` sets; any new Base UI part in `@circi/ui` needs an edit here (comment says so). It imports `e2e/src/timing-reporter.ts`, `packages/ui/tokens-css.ts` and `packages/vitest/src/index.ts` by relative path. Suggest per-project files (`vitest.project.ts` helpers under `packages/vitest/src/config/` or `tools/`) so each workspace owns its project, root file only lists them.
- **oxlint / oxfmt**: single root config each, no per-workspace overrides: good. One gap: `import/no-cycle` guards files, nothing guards the layer rules in CLAUDE.md (repositories must not import jobs is enforced by a test, `apps -> services -> db -> core` is not enforced at all). An oxlint `no-restricted-imports` override per workspace folder would cover it.
- **Build**: `apps/server`, `packages/cli`, `packages/vitest`, `packages/ui` each have a `tsdown.config.ts`; the server one carries 40 lines of sourcemap/condition boilerplate that `cli` and `vitest` partially repeat (`conditionNames`, `onLog`). A `tsdown.shared.ts` is S.

## 5. Per-workspace review

### 5.1 apps/server (138 files, 7726 lines in src; 49 test files)

Structure: `src/{main.ts, contract-check.ts}`, `cli/` (4), `http/{app.ts, hooks/5, lib/13, routes/{auth,health,integration-webhook}.ts, routes/argos/1, routes/dashboard/34, routes/v1/6, sites/2}`, `lifecycle/` (7). Tests mirror `src` except `test/http/routes/dashboard` (32 files).

Largest: `routes/dashboard/integrations-generic.ts` 723, `cli/admin.ts` 611, `http/lib/github-app.ts` 273, `routes/dashboard/reviews.ts` 284, `routes/argos/index.ts` 276, `routes/dashboard/settings.ts` 311 (tests: `sites.test.ts` 569, `github-app.test.ts` 538).

Judgement:

- Layer-organised (hooks/lib/routes) with feature slices cut across it (finding 2). `routes/dashboard/` is flat with 34 files; its names already group: `workspace-{auth,builds,settings,sso}.ts` + `workspaces.ts` + `domains.ts`; `instance-{accounts,health,settings,workspaces}.ts` + `instance.ts`; `integrations{,-generic}.ts`, `issue-trackers.ts`, `github-app.ts`; `project-sites.ts`, `projects.ts`, `site-handoff.ts`.
- `http/lib/` (13) mixes unrelated things: access guards (`project-access`, `workspace-access`), presenters, streams, `github-app.ts` (273 lines of feature logic), `instance-settings.ts` (132, a service-like module), `pages.ts` (9 lines), `install-state.ts` (**2 lines**, a constant).
- `contract-check.ts` (155) sits at `src/` root and is a typecheck-only file; it belongs next to the types it checks, e.g. `src/contract/` or a test.
- `cli/admin.ts` 611 lines holds every admin command (users, workspaces, tokens, doctor wiring). `lifecycle/doctor.ts` is also CLI-ish.
- `routes/argos/index.ts` is a compat layer with a different layout than `v1/` (single 276-line file).
- Test tree is clean; `test/support/` (4) is the only shared helper place.

Proposal (mapping):

| Current | Proposed | Reason |
|---|---|---|
| `http/routes/dashboard/workspace-*.ts`, `workspaces.ts`, `domains.ts` | `http/routes/dashboard/workspace/{index,auth,builds,settings,sso,domains}.ts` | one folder per prefix, `index.ts` registers |
| `http/routes/dashboard/instance*.ts` (5) | `http/routes/dashboard/instance/{index,accounts,health,settings,workspaces}.ts` | same |
| `dashboard/integrations.ts`, `integrations-generic.ts`, `issue-trackers.ts`, `github-app.ts`, `routes/integration-webhook.ts`, `lib/github-app.ts`, `lib/install-state.ts`, `lib/integration-context.ts`, `lifecycle/integration-config.ts` | `http/features/integrations/…` (see below) | one folder per slice; `integrations-generic.ts` (723) splits into `connect.ts`, `mapping.ts`, `links.ts` |
| `routes/v1/sites.ts`, `dashboard/project-sites.ts`, `dashboard/site-handoff.ts`, `http/sites/{serve,cookie}.ts` | `http/features/sites/{upload,dashboard,handoff,serve,cookie}.ts` | the site slice in one place; `serve` is a different host, so keep a `serve/` subfolder |
| `http/lib/pages.ts`, `lib/install-state.ts` | inline into their one consumer / `http/lib/constants.ts` | 9- and 2-line files |
| `http/lib/instance-settings.ts` | `packages/services/src/instance-settings.ts` (if it only wraps repositories) | business logic belongs in the service layer |
| `src/contract-check.ts` | `src/contract/check.ts` | name the intent |
| `cli/admin.ts` (611) | `cli/admin/{users,workspaces,tokens,index}.ts` | one command group per file |

Target shape: `http/{app.ts, hooks/, lib/ (guards, errors, validation, presenters, streams only), routes/{auth,health,v1,argos}, features/{integrations,sites,workspace,instance,…}}` (S per folder; routes tests move in lockstep). Alias additions: `#features/*` is free here.

### 5.2 apps/worker (22 files, 1 package `exports`)

`src/{index.ts, runner.ts 416, jobs/6, lib/2}`; tests mirror it. Judgement: small and clean. `runner.ts` (416) combines the polling loop, the job registry/dispatch and the LISTEN/NOTIFY wiring; `jobs/review-sweep.ts` is 11 lines (a one-line job, fine). `lib/{concurrency,files}.ts` are generic helpers. `package.json` declares `exports` although only the server imports it (`startWorker`, `processBuild`): fine, but then nothing should be reached around the barrel (nothing is).

Proposal: split `runner.ts` into `runner/{loop,dispatch,listen}.ts` (S, optional). No renames needed. Move `lib/concurrency.ts` into a shared place only if another consumer appears (none now).

### 5.3 apps/web (363 files; src 187 + test 176)

Structure: `src/app/` (24: shell, sidebar, switchers, router, shortcuts), `src/lib/` (17 + `stores/` 5), `src/features/<14+1>/`. Tests mirror features. Totals per feature (src): projects 50, builds 36, settings 24, integrations 17, instance 16, auth 15, account 8, members 7, insights 6, sites 5, baselines 4, command 4, reviews 4, triage 4, views 4, inbox 3, sidebar 1.

Largest src files: `instance/AccountsPage.tsx` 522, `projects/BuildsBrowser.tsx` 513, `app/shell-model.ts` 269, `app/Sidebar.tsx` 284, `lib/shortcuts.ts` 388. Largest tests: `app/Shell.browser.test.tsx` 763, `builds/BuildPage` 588, `integrations/GenericIntegration` 552.

Consistency matrix (what each feature has):

| Feature | api.ts | routes.ts | Page | extra `*-api.ts` | model/logic | Remark |
|---|---|---|---|---|---|---|
| account, baselines, inbox, insights, members, reviews, settings, sites, triage, views, projects, builds, integrations, instance | yes | yes | yes | builds 2 (`discussion-api`, `issues-api`), projects 1 (`new-project-api`), instance 2 (`admin-api`, `github-app-api`), integrations 1 (`generic-api`) | mixed names (`model.ts`, `build-state.ts`, `review-model.ts`, `builds-filters.ts`, …) | |
| auth | yes | **no** | LoginPage, SetupPage | | `login-helpers.ts` | check where its routes are mounted; document or add `routes.ts` |
| command | yes | no | CommandMenu (dialog, not a page) | | `model.ts` | component, not a route feature |
| sidebar | yes (only file) | no | none | | | a lone `api.ts`; UI is in `app/Sidebar.tsx`; consumed by `insights` and `integrations` |

Problems:

1. **`projects` (50) is three features**: (a) project CRUD and chrome (`ProjectsPage`, `ProjectPage`, `NewProjectDialog`, `CreateDialogs`, `ProjectDialogs`, `DeleteProjectSection`, `new-project*.ts`, `delete-project.ts`, `appearance.ts`, `AppearanceSection`), (b) the build list (`BuildsBrowser`, `BuildFilterBar`, `BulkRejectDialog`, `builds-filters.ts`, `display-options.ts`, `loading.ts`, `GitAttentionBanner`), (c) project settings pages (`ProjectSettings*`, `SettingsForm`, `settings-patch.ts`, `flaky-setting.ts`, `SecretBox`, `CiTokenPage`, `WebhooksPage`, `webhook-events.ts`, `IgnoreRegionsPage`, `RegionStage`, `ignore-regions*.ts`).
2. **Region code duplicated by concern across features**: `builds/{RegionLayer,regions.ts}` and `projects/{RegionStage,ignore-regions.ts,ignore-regions-search.ts}` both deal with rectangles on a screenshot. Shared drawing/geometry belongs in one place.
3. **`settings` holds workspace settings** (`WorkspaceGeneralPage`, `WorkspaceSso`, `WorkspaceStoragePage`, `EmailDomains`) next to user-level (`AppearancePage`, `ShortcutsPage`, `NotificationsPage`) and review settings (`ReviewsSettingsPage`, `RulesSection`, `RotationSection`) while `account` is the other "you" feature and `reviews` (4) the other review feature. With the vocabulary project/workspace the folder names should say which.
4. **`app/` mixes shell with feature-ish components**: `Projectswitcher`, `WorkspaceSwitcher`, `WorkspaceTile`, `SettingsNav`, `use-workspaces.ts` are project/workspace features; `placeholder-routes.tsx`, `ComingSoon.tsx`, `NotFound.tsx` are stubs.
5. **`lib/` mixes** hooks (`use-list-navigation`, `use-client-link`), components (`PageHeading`, `ErrorState`, `TabList`, `SnoozeMenu`, `RelativeTime`, plus 2 module CSS), pure logic (`snooze.ts`, `relative-time.ts`, `list-keys.ts`, `shortcuts.ts` 388) and the 4 zustand stores. Several belong in `@circi/ui` (`PageHeading`, `ErrorState`, `TabList` are design-system parts that already have siblings there: `Heading`, `EmptyState`, `SegmentedControl`).
6. **Cross-feature coupling**: 25 imports of `#features/projects/*`, 20 of `#features/builds/*`, 12 of `settings`; `projects -> {builds, integrations, members, reviews, sidebar, views}` and `builds -> integrations`, `integrations -> instance`, `instance -> integrations` (a cycle at feature level; no file cycle).
7. **Naming**: `api.ts` + `*-api.ts` (23 files named `*api*.ts`); logic files are `model.ts` in 4 features, `*-model.ts` in 2, free names elsewhere; CSS modules sit beside components (correct per CLAUDE.md) but `Settings.module.css`, `Admin.module.css`, `Integrations.module.css`, `Links.module.css` are feature-wide sheets, not per component.
8. State: stores exist only in `lib/stores` (display, list, overlay, shortcut). Feature-local `useState` is in line with CLAUDE.md; nothing to flag.

Proposed structure (`src/features/` flat list stays, sub-folders inside heavy features; each feature: `api.ts` (or `api/`), `routes.ts`, `*Page.tsx`, `components/`, `lib/` or `model.ts`, `*.module.css` beside components):

| Current | Proposed | Reason |
|---|---|---|
| `projects/{ProjectsPage,ProjectPage,ProjectsEmpty,NewProjectDialog,CreateDialogs,ProjectDialogs,DeleteProjectSection,new-project*,delete-project,appearance,AppearanceSection}` + css | `features/projects/…` (stays, slimmed) | project CRUD |
| `projects/{BuildsBrowser,BuildFilterBar,BulkRejectDialog,builds-filters,display-options,loading,GitAttentionBanner}` + css | `features/builds/list/…` | the build list is builds; kills 25 `projects` imports |
| `projects/{ProjectSettings*,SettingsForm,settings-patch,flaky-setting,SecretBox,CiTokenPage,WebhooksPage,webhook-events}` + css | `features/project-settings/…` | one page family with its frame |
| `projects/{IgnoreRegionsPage,RegionStage,ignore-regions*}` + `builds/{RegionLayer,regions}` | `features/regions/` (shared geometry in `regions/geometry.ts`) | one concern, two features use it |
| `builds/{api,discussion-api,issues-api}.ts` | `builds/api/{index,discussion,issues}.ts` | one api folder per feature (rule: >1 api file becomes `api/`) |
| `builds/` 36 files | `builds/{components,discussion,issues,review}/…` + `BuildPage.tsx` | 4 sub-areas already visible in file names |
| `settings/{WorkspaceGeneralPage,WorkspaceSso*,WorkspaceStoragePage,EmailDomains,SignIn*}` | `features/workspace-settings/…` | name matches vocabulary and `/workspace` route |
| `settings/{ReviewsSettingsPage,ReviewTargetSection,RotationSection,RulesSection}` | `features/reviews/settings/…` | next to `reviews` |
| `settings/{AppearancePage,ShortcutsPage,NotificationsPage}` | `features/account/…` | user-level preferences |
| `app/{Projectswitcher,WorkspaceSwitcher,WorkspaceTile,use-workspaces,SettingsNav}` | `features/sidebar/…` (also absorbs `sidebar/api.ts`) | `sidebar` is currently an api file only; `app/` keeps shell, router, providers |
| `app/{placeholder-routes,ComingSoon}` | `features/placeholders/` or delete when real pages exist | stubs |
| `lib/{PageHeading,ErrorState,TabList,SnoozeMenu,RelativeTime}` + css | `packages/ui` (generic ones) / `features/builds/…` (`SnoozeMenu`) | design-system parts |
| `lib/stores/*` | stays (aliasable as `#lib/stores/*`) | good |
| `test/lib/project-appearance.test.ts` deep import into `packages/ui/src` | import from `@circi/ui` (export `PROJECT_ICONS`) or move test to `packages/ui/test` | finding 7 |

Make `features/auth` and `features/command` explicit in `CLAUDE.md` ("components and pages mounted outside the route tree have no `routes.ts`"). Features that need each other should expose a `index.ts` of what is public (today other features reach into files like `#features/projects/api.ts`, 25 deep imports).

### 5.4 e2e (315 files on disk; 25 source files, 2765 lines in `src`, 26 test files)

`src/` 21 flat files (`stack`, `pool`, `docker`, `admin`, `people`, `sites`, `upload`, `s3`, `storage`, `mail`, `images`, `git-repo`, `github-helpers`, `browser`, `client-address`, `dns-preload`, `global-setup`, `paths`, `vitest`, `timing-reporter`, `index`) + `fakes/` (4, `fake-github` 480). `test/` 22 `*.e2e.test.ts` flat + `test/fakes/` (4 plain Node tests).

Judgement: sensible, but `src/` is flat with three groups. `sites.ts`/`upload.ts` duplicate in role `packages/cli`. Test names group by feature already (`github-*` x4, `storage-*` x3, `sites*` x2).

Proposal: `src/stack/{stack,pool,docker,global-setup,paths,images}.ts`, `src/clients/{admin,people,sites,upload,mail,s3,storage,browser}.ts`, `src/github/{github-helpers,git-repo}.ts` + `fakes/`, `src/reporting/timing-reporter.ts`; tests into `test/{github,storage,sites,…}/`. `#src/*` becomes `#stack/* #clients/*`. Size S–M, no behaviour change; the root vitest `include` globs (`e2e/test/**/*.e2e.test.ts`) already allow sub-folders.

### 5.5 packages/api (22 files, 1405 lines, types only)

One namespace per resource, 21 files, none above 190 lines. Clean. Tiny files: `flaky.ts` (8), `figma.ts` (12), `site.ts` (25), `baseline.ts` (26): fine as one namespace each. Gaps: `index.ts` (29) is the only public surface and exports namespaces only (good). No `imports` map (not needed). The only change: resource names vs. vocabulary (`workspace.ts` and `project.ts` ok). Boundary with core: api is "wire shapes", core has the same shapes as inline types in several files (`core/src/integrations.ts` defines `IntegrationCatalog` namespace, api has `Integration`): two catalog type families. Move `IntegrationCatalog.*` to api (`Integration.Catalog…`) only if core stops being the producer; currently correct to keep in core because `@circi/integrations` builds it. Verdict: **keep as is**.

### 5.6 packages/auth (30 files, 1214 lines)

`src/{auth,options,mail,cookies,constants,schema-config}.ts`, `hooks/4`, `operations/3`, `plugins/4`, `sso/2`; tests mirror. Good layout and the `#hooks/*` etc. aliases are used consistently. Issues: `plugins/index.ts` (63) assembles plugins while `plugins/sso.ts` and `sso/sso.ts` share a name and topic (`sso/` = `trusted-issuers`, `sso`; `plugins/` = `sso`, `workspace-sso`); merge `sso/` into `plugins/sso/`. `mail.ts` (117) is a root-level concern file next to the composition root. `operations/admin.ts` 272 is the largest file.

| Current | Proposed |
|---|---|
| `src/sso/{sso,trusted-issuers}.ts` | `src/plugins/sso/{sso,trusted-issuers}.ts` (+ `plugins/sso.ts` -> `plugins/sso/plugin.ts`) |
| `src/mail.ts` | `src/mail/index.ts` or keep (S, optional) |

### 5.7 packages/cli (17 files, 1405 lines; published)

Flat `src` of 8: `api`, `ci-env` 298, `files`, `git`, `main` 167, `site`, `upload` 278, `index`. Tests mirror (`ci-env.test.ts` 323). Clean and small; the only one with a relative `../` (1) in src. `site.ts` + `upload.ts` are the two commands, `main.ts` the entry. Proposal: `src/commands/{upload,site}.ts`, `src/ci/{ci-env,git}.ts` only if a third command appears. **Keep.** Dedupe candidate: `cli/src/api.ts` (224) is a client for the v1 API whose types are redeclared; check against `@circi/api` (cli has no deps by design as it is published; fine).

### 5.8 packages/config (5 files)

`src/index.ts` 485 lines: env zod schema, `Config` namespace + interface (lines 87-200), `loadConfig` (211-465), `staticSitesHostProblem`. One barrel that is code, i.e. not a barrel. `public-url.ts` already split out and re-exported.

Proposal: `src/{schema,types,load,sites-host,public-url}.ts` + `index.ts` as true barrel (S). Consumer is only `server`; consider moving into `apps/server/src/config/` (M, optional) since no other workspace needs it and the worker gets values by argument. Keep the package if you want `@circi/e2e` or `cli` to reuse `parsePublicAddress` later; today they do not.

### 5.9 packages/core (45 files, 1373 lines src)

25 flat files, each 23-160 lines; no mixed concerns inside a file, but the folder mixes four domains: build rules (`baseline`, `outcome`, `pairing`, `limits`, `flaky`, `build-filters`, `insights`, `review-target`, `rules`, `rotation`, `snooze`, `mentions`), integrations catalog (`integrations`, `events`, `issues`, `figma`), crypto/security (`token`, `secrets`, `signed-state`, `webhook`, `webhook-url`), and naming (`slug`, `project-appearance`, `errors`). Barrel is 95 lines, alphabetically random. The subpath exports exist because of the `node:` imports (finding 4).

Proposal (S-M, mechanical):

| Current | Proposed | Reason |
|---|---|---|
| `slug, project-appearance, mentions, snooze, build-filters, insights, flaky, rules, rotation, review-target, baseline, outcome, pairing, limits, errors` | `src/builds/…`, `src/review/…`, `src/naming/…` folders, re-exported by `index.ts` (browser-safe) | cohesion; `@circi/core` stays free of Node |
| `token, secrets, signed-state, webhook, webhook-url` | `src/node/…` exported as `@circi/core/node` | the only Node-only files; web then imports plain `@circi/core` (removes the 4 subpaths and 5 deep imports) |
| `integrations, events, issues, figma` | `src/integrations/…` | one folder, one subpath if needed |

### 5.10 packages/db (124 files; src 82 + 22 + 13 tests, 3 migrations)

`src/{client,errors,types,index}.ts`, `schema/25` (1623 lines total; `auth.ts` 232 generated), `repositories/29`, `queries/20`; tests mirror (`test/repositories` 22, `test/queries` 13). Largest: `repositories/builds.ts` 595, `repositories/sites.ts` 537, `queries/insights.ts` 410, `repositories/git.ts` 393.

Judgement: layering is good and enforced. Issues: (a) the barrel is `export *` over 46 modules (250 functions) with an unordered list; (b) schema files, repositories and queries mirror by name (`builds`, `comments`, `integrations`, `reviews`, `sites`, `projects`, `triage` in 2 or 3 folders), so a change to one concept touches three folders; (c) 3 migrations named `0000_initial`, `0001_project_appearance`, `0002_unique_the_phantom` (generated name, inconsistent); (d) `repositories/sites.ts` (537) and `builds.ts` (595) mix several aggregates (e.g. builds + ancestors + shards + stats); (e) `schema/enums.ts`, `_columns.ts` fine.

Proposal: keep layer-first (it matches CLAUDE.md and the `layers.test.ts` rule), but (1) group the barrel by layer (`export * as repositories`? too disruptive) — at least make `index.ts` sorted and add a `@circi/db/queries` and `@circi/db/repositories` subpath so the read-model/store split is visible to importers (S); (2) split `repositories/builds.ts` into `builds/{create,lookup,ancestry,stats}.ts` and `sites.ts` into `sites/{versions,aliases,lookup}.ts` (M); (3) add `#queries/*` alias (S); (4) rename `0002_unique_the_phantom.sql` via `drizzle-kit generate --name` convention (S, only before any deployment, since migration names are ledger entries).

### 5.11 packages/diff (3 files)

One file, 188 lines: `readPngInfo`, `diffImages`, `makeThumbnail`, `InvalidImageError`. Uses `sharp` and `pixelmatch`; only `worker/src/jobs/process-build.ts` imports it. Judgement: it is a worker module with its own package.json, `exports`, `imports`, a test. It does keep the native `sharp` dependency out of other graphs, but `@circi/server` already inlines the worker.

Proposal: either (a) fold into `apps/worker/src/image/{diff,thumbnail,png}.ts` (its natural home) or (b) rename the package to `@circi/images` and merge `sites`' image-free code? No: only (a). If the server is ever to validate PNGs on upload, keep it as a package; today there is no such caller. M-small.

### 5.12 packages/integrations (23 files, 2008 lines) and packages/providers (32 files, 2494 lines)

`integrations/src`: `definition.ts` 393 (the interface + context), `define.ts`, `registry.ts`, `public.ts` (catalog build), `mapping.ts`, `errors.ts`, `resolve.ts` (14), `git-support.ts`, `tracker-support.ts` + one file per kind (`bitbucket, figma, github, gitlab, jira, linear, slack`). `providers/src`: `provider.ts`/`tracker.ts` (interfaces), `render.ts`, `slack-messages.ts`, `tracker-error.ts` (8 lines), `github-manifest.ts`, and the same seven kinds as clients (`github.ts` 383, `gitlab.ts`, `bitbucket.ts`, `figma.ts`, `jira.ts`, `linear.ts`, `slack.ts`). Tests: `providers/test/support/` has 7 fake hosts, `integrations/test` 5 files.

Boundary today: `providers` = HTTP clients + message rendering (no deps); `integrations` = definition (connect, webhook, map) wrapping a provider, plus the registry. Core holds the planned catalog. Evidence of leakage:

- `integrations/github.ts` imports `GithubApp, headerValue, isConnectionRevoked, parseCommand` from providers and the server imports `GithubApp`, `buildGithubManifest`, `convertGithubManifestCode` from providers directly (`apps/server/src/http/lib/github-app.ts`, 13 total provider imports) — the registry is bypassed for GitHub App features.
- `providers/src/index.ts` is a flat 87-line list of per-kind exports.
- `INTEGRATION_CATALOG` (planned kinds) sits in `core`, built entries in `integrations`, catalog assembly in `integrations/public.ts`; 3 locations for "which integrations exist".
- `providers/{figma,jira,linear,slack}.ts` and `integrations/{figma,jira,linear,slack}.ts` have no cross-kind sharing besides `tracker.ts`/`tracker-support.ts` and `git-support.ts`/`provider.ts` (two parallel "support" files).

Options:

- **A (recommended, M)**: merge into one package `@circi/integrations` organised per kind: `src/kinds/<kind>/{client.ts, definition.ts, messages.ts}`, `src/sdk/{definition,define,registry,mapping,errors,public}.ts`, `src/git/{provider.ts,support.ts,render.ts}`, `src/tracker/{tracker.ts,support.ts,error.ts}`. One connector = one folder; `index.ts` exports only the SDK + registry + the few clients the server needs through `@circi/integrations/github`. Removes `providers` as a package (and its 12+7 `#src` aliases). Effort: file moves + import rewrites in `server` (13), `worker` (4), `e2e` (1), tests (`providers/test` 10 + `support/` 7).
- **B (S)**: keep two packages, reorganise inside each by kind folder and publish the app-facing GitHub App pieces via `integrations` so apps stop importing `@circi/providers`; document the rule (apps import `integrations`, never `providers`). Lint with `no-restricted-imports` for `apps/**`.

Catalog: move `core/src/integrations.ts` to `integrations/src/catalog.ts` and let `web` import it through a browser-safe subpath `@circi/integrations/catalog` (it is static and pure), after which `core` loses its 4-file integrations domain. Needs `integrations` to stay free of Node imports in that file; check `web` bundle size.

### 5.13 packages/services (38 files, 2088 lines)

17 flat files: `builds`, `comments`, `gate`, `git-events`, `git-links`, `git-kinds` (**4 lines**), `integration-events`, `integration-links` 251, `issues`, `migrate-storage`, `notifications`, `retention`, `reviews` 372, `projects` (**10 lines**, one wrapper), `triage`, `views`, `index.ts` (80, 16 `export` groups). Tests 20 files mirror.

Judgement: flat and cohesive (one file per aggregate); it does what CLAUDE.md says. Near-empty: `projects.ts` (one transaction wrapper: it is the only service where a repository call is wrapped without queuing anything — CLAUDE.md says plain writes call the repository directly, so this wrapper is dead weight or should carry the future notice), `git-kinds.ts` (one function that re-exports `integrationRegistry.gitKinds()`; used by repositories' callers). `services` depends on `integrations` just for that and for `integration-links`/events. `git-events.ts`/`git-links.ts`/`integration-*` are the integration-facing group.

Proposal: group into `builds/{builds,gate,retention,reviews,…}`, `integrations/{events,links,git-events,git-links,kinds}`, `collab/{comments,notifications,triage,views,issues}` only once the file count passes ~25; today (17) it is fine. Do now: delete `git-kinds.ts` (inline) and either delete `projects.ts` or move it next to its caller (S). Keep `migrate-storage.ts` (used by an admin CLI command) but note it is an operations script living in the domain service layer.

### 5.14 packages/sites (12 files, 502 lines)

`addresses` (labels, hashes, slugs), `kinds` (static site kinds), `paths`, `mime`, `ingest` (tar -> files), `index` (17). `slugify` exists here and in `core/slug.ts` with different semantics (40 vs configurable length, NFKD accent stripping vs none): two functions with the same name, neither imports the other, and `sites` exports its own from the barrel next to `core`'s in apps that import both (server). Only consumer: server (4 files). It depends on `tar`.

Proposal: rename `sites`' export `siteSlug` (S) to prevent import mistakes; either keep as the home for static-site logic (fine) or move into `apps/server/src/http/features/sites/` (M) if no second consumer appears. Do not merge with `core` (it pulls `tar`, a Node-only dependency).

### 5.15 packages/storage (8 files, 481 lines)

`fs.ts`, `s3.ts` (231), `keys.ts`, `types.ts`, `index.ts` (18). Clean driver pattern, exports are narrow (barrel 18 lines). `storage` is imported by the server 38 times (largely test helpers/`createStorage`), by services and worker. **Keep.** Consider `drivers/{fs,s3}.ts` if a third driver ever lands.

### 5.16 packages/testing (14 files, 755 lines)

`db.ts` (PGlite handle, 120) and `seed/` (11 files). Barrel 17 lines. Imported by 38 server tests, 36 db tests, 19 services tests (`@circi/testing`). Findings: devDep cycle with `db` (finding 6); a package named `testing` that depends on `db` seeds data model: `seed/sites.ts` comments that it cannot call `@circi/sites` services, so seeds can drift from services. No `imports` map; `seed/*` has no alias.

Proposal: keep as a package (only way PGlite test DB can be shared); break the cycle by making `@circi/testing` a peer of db (move `db`'s own tests to `@circi/testing/db`-free helpers) or accept it and declare `testing` as `devDependencies` consistently with `workspace:*` plus a root note in CLAUDE.md. Pragmatic: add `docs`-level note; real fix is L. Optionally rename to `@circi/test-support` to match `support/` folders elsewhere (S, low value).

### 5.17 packages/ui (255 files; src 96 incl. 43 `.module.css`; test 47+; visual 3)

Flat `src/` of 96: 48 component pairs `Name.tsx` + `Name.module.css` (mandated by CLAUDE.md), plus non-component files `cx.ts`, `icons.ts` 159, `theme.ts` 182, `color-scheme.ts`, `project-icons.ts`, `css-modules.d.ts`, `global.css`, `index.ts` (62). `tokens-css.ts` and two `tsconfig.*.json` at the package root. Tests are `test/<Name>.browser.test.tsx` (48) + `theme.test.ts`.

Judgement: consistent and enforced by convention; barrel is 62 lines, one export group per component (fine). Flat folder is OK at 48 components but mixes four kinds of file. Minor: 5 components are not in the folder pairing (`Announcer`, `Delayed`, `Ref`, `SkipLink`, `CirciTheme` are small utilities) and `project-icons.ts` duplicates `core`'s icon names.

Proposal: leave components flat (the one-pair-per-component rule is the value); move the non-component files to `src/foundation/{cx,icons,theme,color-scheme,project-icons}.ts` and `global.css`/`css-modules.d.ts` to `src/styles/` (S); add `exports` entries `./tokens-css` (the Vite plugin; removes the 2 relative imports) and `./css-modules` (types) (S). Replace `main`/`types` with `exports` only.

### 5.18 packages/vitest (14 files)

`src/{browser,collect,index,reporter,screenshot,shard}.ts`; published; own `tsconfig.json` identical to `cli`'s. Clean. The root `vitest.config.ts` imports its source by path rather than via `@circi/vitest` (cannot import itself before build: legitimate, but `exports` has `@circi/source` condition that would work). **Keep**; fix the relative import (S).

## 6. Root-level files

| Item | Status | Suggestion |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml` (`catalog:` of ~60 entries), `.nvmrc`, `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig*.json`, `vitest.config.ts` (190 lines) | fine, see section 4 | split vitest config |
| `PLAN.md` (721), `README.md` (173), `CLAUDE.md` | design doc, use doc, conventions | fine |
| `docs/` 13 plan files (`refactor-plan`, `remaining-work`, `next-steps-plan`, `linear-features-plan`, `tsdown-plan`, `e2e-speed-plan`, `base-ui-plan`, `design-gaps`, `argos-migration`, ...) | planning notes mixed with reference (`integration-sdk`, `static-sites`, `vitest`, `ci-examples`) | `docs/plans/` vs `docs/reference/`; archive completed plans (`tsdown-plan`, `base-ui-plan`, `refactor-plan`, `e2e-speed-plan`) |
| `.design-sync/` (42 tracked files: config, conventions, previews) | tracked | OK, but `.ds-sync/` (46 MB), `ds-bundle/` (7.6 MB), `.vitest/`, `.circi/` are untracked (in `.gitignore`) tooling droppings in the root; consider `tools/design-sync/` for config + scripts and one ignored `.cache/` |
| `deploy/` (Dockerfile, compose x3, Caddy, README) | fine | |
| `e2e/README.md`, `README.sites.md` | fine | move `README.sites.md` into `docs/static-sites.md` |
| `.github/workflows/ci.yml` (80) | single workflow | none |

## 7. Prioritised changes

Value: H/M/L; size: S (< 1 h, a few files), M (half a day), L (day+, many files). "Par." = can run as parallel Sonnet agents with disjoint file sets (listed). Every change must keep `pnpm format && lint && typecheck && test && build` green and edit docs/CLAUDE.md paths it moves.

| # | Change | Value | Size | Par. file set |
|---|---|---|---|---|
| 1 | Type-check `apps/web/test` and make `apps/web/tsconfig.json` extend base; add shared `tsconfig.node.json`/`tsconfig.dom.json` (finding 5) | H | S | `tsconfig*.json`, `apps/web/tsconfig.json`, package tsconfigs; fix whatever tsc then reports in `apps/web/test` (own agent first, others wait) |
| 2 | Split `apps/web/features/projects` into `projects`, `builds/list`, `project-settings`, `regions`; move region code from `builds` | H | M-L | `apps/web/src/features/{projects,builds}` + their tests; A1 |
| 3 | `apps/web`: settings split (`workspace-settings`, `reviews/settings`, `account`), switchers from `app/` to `sidebar`, `lib/` components to `@circi/ui` | M | M | `apps/web/src/{app,lib}`, `features/{settings,sidebar,account,reviews}`, `packages/ui/src` (new files only); A2, after #2 touches no common files |
| 4 | Server: group `routes/dashboard/` into folders by slice (`workspace/`, `instance/`, `integrations/`, `sites/`); split `integrations-generic.ts` and `cli/admin.ts`; delete 2- and 9-line files | H | M | `apps/server/src/http`, `src/cli`, `apps/server/test/**` mirrors; A3 (server only) |
| 5 | `@circi/core`: move the 5 `node:` files to `@circi/core/node`, folder by domain, drop the 4 subpaths, web imports `@circi/core` | H | M | `packages/core/**`, import rewrites in all workspaces (`grep '@circi/core'`; touches many files, so run alone or in a quiet window) |
| 6 | `@circi/db` barrel: sorted, `queries`/`repositories` subpaths, `#queries/*`, split `builds.ts` and `sites.ts` repositories | M | M | `packages/db/src/{index.ts,repositories/builds*,repositories/sites*}`; import rewrites in consumers only if subpaths are enforced (do not enforce yet); A4 |
| 7 | `integrations` + `providers`: option A merge (or B at minimum) incl. catalog move from core | H | L | `packages/{integrations,providers}/**`, `packages/core/src/integrations.ts` + 4 consumers (`server` 13, `worker` 4, `e2e` 1, `web` 2); run alone after #5 |
| 8 | Fix cross-workspace relative paths: export `@circi/ui/tokens-css`, `@circi/ui/css-modules`; `@circi/vitest` via exports; web test import from `@circi/ui` | M | S | `packages/ui/{package.json,tokens-css.ts}`, `apps/web/{vite.config.ts,tsconfig.json}`, `vitest.config.ts`, `apps/web/test/lib/project-appearance.test.ts`; A5 |
| 9 | Dedupe `PROJECT_ICON_NAMES` (core) and `ui/src/project-icons.ts`; rename `sites`' `slugify` to `siteSlug` | L | S | `packages/ui/src/project-icons.ts`, `packages/core/src/project-appearance.ts`, `packages/sites/src/addresses.ts` + 4 server imports; A5 or A6 |
| 10 | `config` split into `schema/types/load/sites-host`; keep barrel | M | S | `packages/config/src/**`; A6 |
| 11 | `diff` folded into `apps/worker/src/image/`; split `runner.ts` | L | S-M | `packages/diff`, `apps/worker/**`, root `vitest.config.ts` globs (none), `pnpm-lock.yaml`; A7 |
| 12 | `services`: delete `git-kinds.ts` and `projects.ts` wrappers (or document), move `instance-settings` there | L | S | `packages/services/src/**`, one server file; A8 |
| 13 | `e2e/src` into `stack/`, `clients/`, `github/`, `reporting/`; tests into feature folders | M | M | `e2e/**`, `vitest.config.ts` import path of timing reporter; A9 |
| 14 | `auth`: merge `sso/` into `plugins/sso/` | L | S | `packages/auth/**`; A10 |
| 15 | (DONE: db-free `@circi/testing`, seeders and PGlite helper in `@circi/db/testing`) Break `db <-> testing` devDep cycle or document; consistent dependency declaration for bundled apps | M | M-L | `packages/testing/**`, `packages/db/test/**` (every db test imports it: 36) |
| 16 | `no-restricted-imports` overrides to enforce layers (apps never import `providers`/repositories where services exist; web never imports Node-only core) | M | S | `.oxlintrc.json` only; best after #5/#7 |
| 17 | Docs: `docs/plans` vs `docs/reference`, archive finished plans, `ds-sync` to `tools/` | L | S | `docs/**`, `.gitignore`, `.design-sync/**` |
| 18 | Shared `tsdown.shared.ts` for server/cli/vitest/ui | L | S | the four `tsdown.config.ts` |

Parallel groups with disjoint files, to run together after #1: **A1** (#2), **A2** (#3 — start after A1 merges because both touch `features/projects` imports in `app/`), **A3** (#4), **A4** (#6), **A5** (#8, #9 ui/web parts), **A6** (#10, `packages/config` only), **A7** (#11), **A8** (#12), **A9** (#13), **A10** (#14). Sequential, alone: #5 then #7 then #16 (they rewrite imports across workspaces and collide with everything). Suggested order: #1, then A1/A3/A4/A5/A6/A9/A10 in parallel, then #5, #7, #16, then A2/A7/A8, then #15 and #17-18.

## 8. Conventions to add to CLAUDE.md (after the moves)

- A feature folder in `apps/web` with more than one `api` file uses `api/`; features over ~25 files are split by sub-area (`components/`, `lib/`) and never hold another feature's pages.
- `#src/*` is for tests and sub-folders only; flat package sources import siblings with `./`.
- Apps import `@circi/integrations`, never `@circi/providers` (if option B).
- A server route slice lives in one folder (`http/features/<slice>/` or `routes/dashboard/<slice>/`) including its libs and tests.
- No file reaches into another workspace with a relative path; expose what is shared through `exports`.
