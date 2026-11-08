# Plan: build the packages with tsdown

Status: approved 2026-11-06, scheduled **after the e2e speed work** (`docs/e2e-speed-plan.md`):
those runs build the Docker image through the current build scripts, so the build must not change
under them. Step 1 (packages/ui spike): **done 2026-11-08**, except a full e2e run (see Step 1 result).

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
  maps; only the published CLI may be minified if it measurably helps `npx` start-up.
- `tsc` stays as the type checker (`pnpm typecheck`, `noEmit`); tsdown does the emitting.
- The `development` export condition (source in dev, Vitest and the web app) stays as it is.

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
`apps/server/test/lifecycle/web-dist.test.ts`. Also covered: `circi all|serve|worker` and every
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

- Whether to minify the published CLI (measure `npx circi --version` time first).

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
