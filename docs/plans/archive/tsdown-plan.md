# Plan: build the packages with tsdown

Status: approved 2026-11-06, scheduled **after the e2e speed work** (`docs/plans/archive/e2e-speed-plan.md`):
those runs build the Docker image through the current build scripts, so the build must not change
under them. Step 1 (packages/ui spike): **done 2026-11-08**, except a full e2e run (see Step 1 result).
Step 2 (`@circi/cli`, `@circi/vitest`): **done 2026-11-08** (see Step 2 result). Step 3 (server bundle): **done 2026-11-08** (see Step 3 result). Step 4: **done 2026-11-08** (see Step 4 result). The plan is complete.

## Decisions

- **Version: the latest**, `tsdown` 0.23.5 and `@tsdown/css` 0.23.5 (both published 2026-11-03),
  pinned exactly in the pnpm catalog. pnpm's default minimum release age refuses packages this
  new, so `pnpm-workspace.yaml` gets `minimumReleaseAgeExclude: [tsdown, '@tsdown/*']` (rather
  than switching the age check off for everything). tsdown is pre-1.0: upgrade on purpose and read
  its changelog.
- `@tsdown/css` uses Lightning CSS (which has CSS modules) and `rolldown ~1.2.16`, the same
  Rolldown Vite already uses here.
- **Minifying is not the goal** for Node code (output is 1 to 2 MB per package, the image is
  mostly `node_modules`, and minified stack traces hurt). Bundles keep readable output and source
  maps. Decided 2026-11-08: the published CLI and `@circi/vitest` are not minified either
  (minifying saved 1 ms of start-up). Only `@circi/ui` (browser code) is minified.
- `tsc` stays as the type checker (`pnpm typecheck`, `noEmit`); tsdown does the emitting.
- The source export condition (source in dev, Vitest and the web app) stays, but is renamed `@circi/source` (see Step 2 result).

## Steps

Each step ends with `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build` and
`pnpm test:e2e` green.

### 1. Spike: `packages/ui` (gate)

Replace `vite build && tsc -b`, the token Vite plugin and the `apps/web` alias with one tsdown
build that writes `dist/index.js`, `dist/styles.css` and `dist/*.d.ts`. It must keep:

- CSS modules (Lightning CSS defaults; decided 2026-11-08: no custom class names);
- `global.css` with the token variables generated from `theme.ts` (`tokens-css.ts` becomes a
  Rolldown/tsdown plugin or a pre-step);
- declarations that design-sync's converter reads (`.js` specifiers in `index.d.ts`);
- the Vitest browser tests and `apps/web`'s dev and build.

Check: TypeScript 7 declaration output (tsdown lists `typescript ^7` as a peer), CSS modules class
names in the built CSS, design-sync's local run, the web bundle size. **Report and stop here if
CSS modules or declarations don't work**; the fallback is today's build.

### 2. Published packages: `@circi/cli` and `@circi/vitest`

These are installed by users in CI (`npx circi upload`). Bundle each into one ESM entry (the CLI
with its bin and shebang), inline our workspace packages (`@circi/core`, `@circi/api`, …) so
the published package has no `workspace:` dependencies, keep real third-party dependencies
external, emit declarations for `@circi/vitest`, and turn on tsdown's checks (`publint`,
`@arethetypeswrong/core`). Test: install the packed tarball (`pnpm pack`) into a scratch project
and run `circi upload` against the e2e stack; `@circi/vitest` in a scratch Vitest project.

### 3. One server bundle for the Docker image (decided: part of the plan)

Bundle `apps/server` (with the worker) into one file, workspace packages inlined, native and
heavy dependencies external (`sharp`, `pg`, the AWS SDK, better-auth if it can't be bundled).
Gains: a smaller image and a Dockerfile that doesn't copy a dozen `dist` folders. **Risk:** code
that finds files relative to itself breaks when its file moves (the same class of bug as
`webDistPath` on 2026-11-05): the migrations folder (`packages/db/src/client.ts`), the web app's
`dist`, and any `import.meta.url` path. Each one gets an explicit copy step and a test like
`apps/server/test/lifecycle.test.ts`. Also covered: `circi all|serve|worker` and every
`circi admin …` command from the bundle, source maps on so stack traces point at the TypeScript,
and the e2e suite run against the bundled image. Record image size and start time before and
after in `deploy/README.md`.

### 4. The rest

Internal packages (`core`, `db`, `services`, `auth`, `storage`, …) stop emitting their own
`dist`: the server bundle inlines them and nothing else imports their built output. The
Dockerfile ships the bundle, the migrations, the web app's `dist` and the production
`node_modules` of the externals only. Update `CLAUDE.md` (Commands), `README.md` (Development) and
`.design-sync/NOTES.md`.

## Not decided

- Nothing open.

## Step 1 result (2026-11-08)

`packages/ui` builds with tsdown 0.23.5 + `@tsdown/css` (`packages/ui/tsdown.config.ts`); `vite.config.ts` is gone and `tsc -p packages/ui` only type-checks.

- **One file per component** (`unbundle: true`): `dist/<Name>.js`, `<Name>.d.ts` (relative `./<Name>.js` specifiers), `<Name>.module.js` and `<Name>.css`. `css.inject` makes each `<Name>.module.js` import its own CSS, and `index.js` imports `global.css` (tokens), so a consumer gets styles by importing a component. No `dist/styles.css` and no `./styles.css` export; `package.json` has `sideEffects: ["*.css"]`.
- **CSS modules: Lightning CSS, its defaults.** No custom class names (`S03leq_root`), no PostCSS, no `generateScopedName` (`packages/ui/css-modules.ts` is deleted). Vite 8 and Vitest use their default transformer for the web app and the browser tests. Tests never select by class name: elements a test must find carry a `data-slot` (`skeleton`, `skeleton-list`, `skeleton-row`, `select-popup`).
- **Minified**: JS and CSS (`minify: true`, `css.minify: true`).
- Tokens: `tokens-css.ts` is unchanged and works as a Rolldown plugin; apps/web and Vitest still use it.
- TypeScript 7.0.2 declarations work, with a warning that the `tsgo` generator on TS 7.0 is deprecated (wants TS 7.1+).
- Exports: JS export names identical (83).
- design-sync's local build (`.ds-sync/package-build.mjs`) reads all 71 components' declarations and collects the per-component CSS into `_ds_bundle.css`.
- **The `apps/web` alias must stay**: without it `vite build` resolves `@circi/ui` to dist.
- Numbers: ui build about 0.3 s (old 0.7 s). Web bundle: CSS 55,732 B to 52,113 B (shorter class names), JS 755,475 B to 753,576 B.
- Verified: format, lint, typecheck, `pnpm test` (180 files, 1249 passed, 2 skipped), `pnpm build`. Not verified: a full `pnpm test:e2e` run (stopped); the web app builds `@circi/ui` from source, so the image does not use this dist.

## Step 2 result (2026-11-08)

`@circi/cli` and `@circi/vitest` build with tsdown (`packages/{cli,vitest}/tsdown.config.ts`): `platform: 'node'`, not minified (decided 2026-11-08), source maps, declarations, `publint` and `attw` (profile `esm-only`) on. Everything else is tsdown's defaults.

- **Output is `.mjs` / `.d.mts`** (tsdown's default for Node), so `bin`, `exports` and the e2e's `CLI_MAIN` say `dist/main.mjs`. `@circi/cli` has two entries: `index` (the API; the server tests and `@circi/vitest` use it) and `main` (the bin, shebang kept, made executable by tsdown).
- **`@circi/vitest` inlines `@circi/cli`** (a devDependency now, so no `workspace:` in the tarball); its dependencies are `tar` only (`commander` is not used by the API). The CLI's `dist` must exist first: the root `build` runs `pnpm --filter @circi/ui --filter @circi/cli --filter @circi/vitest build`, which orders them by dependency, and `inputOptions.onLog` makes an unresolved `@circi/cli` an error. A small plugin hands Rolldown the CLI chunks' own source maps, so the vitest map's `sources` are the CLI's TypeScript (with `sourcesContent`).
- **The source condition is `publishConfig`-only.** `exports` has the source condition, `types` and `default`; `publishConfig.exports` is the same without the source condition, which `pnpm pack` applies. `files: ["dist"]`; the CLI's useless `dist/main.d.mts` is excluded (`!dist/main.d.mts`).
- **`development` renamed `@circi/source`** (every package's `exports`, `customConditions`, Vitest `resolve.conditions`, the `circi` and `dev` scripts). Reason: `@arethetypeswrong/core` ships a `development` condition pointing at its raw TypeScript, which our `customConditions: ["development"]` made `tsc` type-check (157 errors). Vitest also needs `ssr.resolve.externalConditions` to include it (Vite added `development` for Node-resolved workspace packages such as `@circi/testing` by itself).
- **Type-checking**: the root `tsconfig.json` now includes the two `tsdown.config.ts` files; each package's own `tsconfig.json` is only for tsdown (`noEmit`) and no longer part of `tsc -b`.
- `circi --version` prints the package version (added 2026-11-08); start-up was measured with `--help`. `tar` bumped from 7.5.2 (deprecated, known vulnerabilities) to 7.5.22.
- publint and attw: clean on both once `files` and the condition were as above. First run reported the `development` file missing from the tarball and the unbuilt `dist/*.js` names (the `.mjs` default).
- Numbers (before = `tsc` output; after = tsdown; `du -k`, tarball = `pnpm pack`): CLI `dist` 180 KB, 15 files, to 112 KB, 7 files; vitest `dist` 80 KB to 100 KB (maps now carry the inlined CLI sources); CLI tarball 68 KB (all files, no `files` field) to 32.8 KB; vitest 29 KB to 33 KB. `circi --help` start-up: 40 ms before, 39 ms after (bare `node -e 0` is 22 ms): minifying does not help, commander and tar loading dominate.
- Verified: installing both tarballs into a scratch project (`npm i`), `circi --help`, `@circi/vitest` in a scratch Vitest project (exports, reporter skipping without a token, types via `tsc`), `circi upload` against the e2e stack. The e2e suite uses the built `dist/main.mjs`.
- Quirks for later steps: tsdown regenerates nothing in `package.json` (we hand-write it); tsdown's pack check runs `pnpm pack`, so a build needs pnpm; making Rolldown (not just `tsc`) resolve a workspace package to its source with `inputOptions.resolve.conditionNames` breaks declaration generation (tsgo refuses `../cli/src` outside the package's `rootDir`, which tsdown pins), hence the source-map plugin instead.

## Step 3 result (2026-11-08)

The Docker image runs one tsdown bundle of `apps/server` (the worker, every workspace package, and most dependencies inlined): `apps/server/tsdown.config.ts`, output `dist/main.mjs` plus 7 chunks (better-auth's lazy dialects), not minified, with source maps, no declarations. `pnpm build` runs it (`--filter @circi/server`); `apps/server` is no longer in `tsconfig.build.json`.

- **Externals = `apps/server/package.json` `dependencies`, and nothing else is configured.** `sharp`, `pg`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`. Everything else, including `better-auth` (and `@better-auth/*`), `drizzle-orm`, fastify, pino, nodemailer, tar, pixelmatch, zod and commander, bundled and ran cleanly through the whole e2e suite. tsdown externalizes a package's own `dependencies` and bundles the rest (devDependencies and transitive ones), so the workspace packages and every bundled library moved to `devDependencies`. Reasons for the four: sharp has native libvips binaries; pg has optional `pg-native` and dynamic requires; the AWS SDK is about 30 packages that load credential providers dynamically (it bundles, but the maps and chunks grow for no gain). `apps/server/test/bundle.test.ts` builds the bundle and fails if the set of bare imports differs from `dependencies`.
- **Workspace packages resolve to their TypeScript** (`inputOptions.resolve.conditionNames` with `@circi/source`), so the server bundle needs no built `dist` of `core`, `db`, `services`, ... (step 4 can delete those builds). `dts` is off, so the step 2 problem (tsgo refusing sources outside `rootDir`) doesn't arise. An unresolved import is an error (`onLog`), as in step 2.
- **Self-relative paths.** A grep of `import.meta.url`, `import.meta.dirname`, `__dirname`, `fileURLToPath` and `new URL(…, import.meta.url)` in `apps/` and `packages/` (excluding `ui`, `cli`, `vitest`, which have their own builds) finds exactly two: `migrationsFolder` in `packages/db/src/client.ts` and `webDistPath` in `apps/server/src/lifecycle/services.ts`. Both now read an environment variable first (`CIRCI_MIGRATIONS`, new; `CIRCI_WEB_DIST`, existing) and fall back to the source-tree path, so dev and tests are unchanged. The Dockerfile sets both (`/app/migrations`, `/app/web`). Tests: `packages/db/test/migrations-path.test.ts` (new), `apps/server/test/lifecycle.test.ts`. Rejected: copying the migrations next to the bundle with tsdown's `copy` (the relative path would then be right only in the bundle, not in the source tree). The other dependencies' own files (`sharp`, drizzle's migrator reading `meta/_journal.json` from the folder it is given) are external or take the explicit path. `e2e/src/paths.ts` and `apps/web/vite.config.ts` are outside the image.
- **Image layout** (flat, `/app`): `dist/`, `migrations/`, `web/`, `node_modules/` (from `pnpm --filter @circi/server deploy --prod`, which installs exactly the four externals and their dependencies, 44 MB, from the lockfile), `circi` symlinked to `dist/main.mjs`. `NODE_OPTIONS=--enable-source-maps`.
- **Source maps**: Rolldown's `sources` were relative to `apps/server/dist` (`../../../packages/db/src/client.ts`), which in the image resolves to `/packages/...`. `outputOptions.sourcemapPathTransform` rewrites them relative to the repo root, one level above `dist`, so a stack trace in the image reads `at async runMigrations (/app/packages/db/src/client.ts:113:18)` and `/app/apps/server/src/cli/server.ts:31:9` (shown with `circi migrate` against an unreachable database). The test pins the `../apps/...` and `../packages/...` form.
- **Commands from the bundled image**: help for all 40 command screens (root, `serve`, `worker`, `all`, `migrate`, every `admin` subcommand, `doctor`); live against a Postgres: `migrate`, `all` (health, dashboard `index.html` served from `/app/web`), `serve` alone, `worker` alone, `admin doctor`, `user create`, `workspace list`, `team`/`member`/`ignore`/`webhook`/`mail` help, `storage usage`, `setup-code`. The e2e suite exercises the rest (`workspace`, `team`, `member`, `webhook`, `github`, `auth`, `storage migrate`, `mail`, ...) through the same image.
- **Numbers** (before = the image built from the previous Dockerfile): image 683 MB to 457 MB; start until `/healthz` OK (empty database, migrations applied) 0.86 s to 0.6 s (median of 5, `docker run` to health, measured by polling); `/app/dist` 17.9 MB (`main.mjs` 5.5 MB, maps 10 MB, chunks the rest), `/app/node_modules` 44 MB. Build: the bundle takes 0.3 s.
- **Verified**: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (182 files, 1254 passed, 2 skipped) and `pnpm build`; `pnpm test:e2e` against the bundled image: 19 files, 147 tests passed in 167 s. Faked as before: GitHub, OIDC, webhook receivers.
- **Quirks for step 4**: `apps/server/tsconfig.json` (composite, `outDir: dist`, references) is now only read by editors and tools; `apps/worker` still builds with `tsc -b` for no consumer except `tsconfig.build.json`'s reference graph. The Dockerfile's build stage still runs the whole `pnpm build` (tsc for the packages the server no longer needs, then the bundle): step 4 can narrow it to the server bundle, the web app and the migrations. (The server's `bin` and `start` now say `dist/main.mjs`.) `pnpm deploy` needs only the manifests and the lockfile, so its layer is cached across source changes. A fresh `pnpm install` is needed after pulling (`tsdown` is now a server devDependency).
- Not decided: nothing open. Not measured: the compressed image size, and cold start on a slow disk (the bundle is one 5.5 MB file; `node --enable-source-maps` costs nothing until a stack is formatted).


## Step 4 result (2026-11-08)

The internal packages (`core`, `db`, `services`, `auth`, `storage`, `config`, `providers`, `sites`, `testing`, `api`, `diff`) and `apps/worker` no longer build. Their `package.json` is `"exports": "./src/index.ts"` and no `build` script; their `tsconfig.json` files (and `apps/server`'s) and `tsconfig.build.json` are deleted.

- **Consumers of their built output: none.** Searched `exports`, the Dockerfile, e2e, design-sync, scripts, CI and the other tsconfigs. The server bundle, Vitest, Vite, the web app's `tsc` and tsdown already resolved them to source through `@circi/source`; Node (`pnpm circi`) reads `.ts` through type stripping (a workspace symlink resolves outside `node_modules`, so stripping applies).
- **Choice: a plain string `exports` pointing at source**, not `@circi/source` plus a `default`. These packages are private and never installed outside the repo, so a `default` pointing at a `dist` that no longer exists would be a lie, and a condition with a single target is noise. `@circi/source` stays where a built output exists beside the source: `@circi/ui`, `@circi/cli`, `@circi/vitest`. Rejected: `exports` with only `@circi/source` (needs the flag in Node, tsc and every tool).
- **Type checking is unchanged**: the root `tsc -p tsconfig.json` always type-checked the whole tree with `noEmit` (apps/worker, apps/server, e2e included); the per-package `tsconfig.json` files only fed `tsc -b`. File lists from `tsc -p <team> --listFilesOnly`, before and after, are identical: root 2906 files, `apps/web` 1782, `packages/ui` 921 (diff empty).
- **Root `build`** is now `pnpm --filter @circi/ui --filter @circi/cli --filter @circi/vitest --filter @circi/server build && pnpm --filter @circi/web build`. `pnpm -r build` fails with a task cycle (`db` and `testing` depend on each other, one as a devDependency), so the filter list stays. `clean` is `rm -rf apps/*/dist packages/*/dist`; `*.tsbuildinfo` is gone from `.gitignore` and `.dockerignore`, nothing writes one.
- **What still emits**: `@circi/ui` (tsdown, browser, minified), `@circi/cli` and `@circi/vitest` (tsdown, published, not minified), `apps/server` (tsdown, one bundle), `apps/web` (Vite). Nothing else.
- **Dockerfile build stage** runs `pnpm --filter @circi/server --filter @circi/web build` (the bundle and the dashboard; the migrations are copied as files) and copies `tsconfig.json` instead of `tsconfig.build.json` (tsdown finds the root config now that `apps/server` has none). The `runtime-deps` stage (`pnpm deploy`) is untouched, so its layer still caches across source changes.
- **Stale output**: every `packages/*/dist` of the internal packages deleted (gitignored build output; `dist/` in `.gitignore` covers what remains).
- **Numbers**: `pnpm build` from clean 1.9 s to 1.25 s (the `tsc -b` of eleven packages was about 1 s). Docker, `--no-cache`, whole build (dominated by `pnpm install`): 30.8 s and 29.4 s before (build stage = `pnpm build`, i.e. also the ui, cli and vitest builds), 29.7 s and 33.6 s after: no measurable difference, the build stage is about 2 s of it either way. No-change rebuild 1.6 s; after a source edit 2.7 s (install and `pnpm deploy` layers cached). Image 457 MB before and after (the image never contained the removed output).
- **Verified**: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`; `pnpm test:e2e` (19 files, 147 tests passed).
- Not decided: nothing open. An editor opening a file under `packages/*/src` finds the root `tsconfig.json` (it includes every package), so the deleted per-package configs cost nothing there.
