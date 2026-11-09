# CirCI: working conventions

Self-hosted visual regression testing (see PLAN.md for the design, README.md for use).

## Commands

Node 26 via nvm, pnpm 12. Before committing: `pnpm format`, then `pnpm gate` (Turborepo: format check, lint, typecheck, test and
build in parallel where independent, each cached by its inputs; a second run on an unchanged tree is instant). The old chain
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` still works. `pnpm build` is `turbo run build`: per-package
caching of `dist/**`, with a `transit` task so a package's build is invalidated by changes in the packages it depends on, but
not by unrelated ones. Tests, lint and typecheck stay single root commands (one vitest process with projects) and are cached as
root tasks (`//#test`, `//#lint`, `//#typecheck` in `turbo.json`); end-to-end (`pnpm test:e2e`) and visual runs are never cached.
What emits what: `tsc` only type-checks (`pnpm typecheck`, `noEmit`). `pnpm build` runs tsdown for
`@circi/ui` (`dist`, browser), `@circi/cli` and `@circi/vitest` (published, `dist`) and `apps/server`
(one bundle for the image), then Vite for `apps/web`. The other packages have no build: their
`exports` point at `src/*.ts`, which Node, Vitest, Vite, tsc and tsdown all read directly.
Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line. No remote repo yet: commits stay local.

## Layers

```
transport    apps/server (http/, cli/), apps/worker (handlers/, jobs/), apps/web (the dashboard)
   v         parse the request, check who is asking, call a service or a read model, shape the reply
services     packages/services/src/<area>/   use cases: open the transaction, call repositories, queue
   v         the jobs and notices that follow (a transactional outbox); the worker's job bodies live here too
core         packages/core                   rules with no I/O: baselines, outcomes, limits, errors, signing
db           packages/db   queries/ (read models for the dashboard), repositories/ (stores and lookups),
             queue/ (jobs, webhook rows, git notices), schema/ (Drizzle), shared/ (helpers they share)
adapters     packages/{providers,integrations,storage,diff,sites}   talk to GitHub, Slack, S3, images
```

Folder map: `apps/server/src/{http,cli,composition}` (`composition/` wires config, db, storage and
the worker; `http/routes/<area>/` holds routes, schemas and presenters); `apps/worker/src` (claim
loop and thin job adapters, no build: the server bundle inlines it); `apps/web/src/{app,lib,features/<feature>}`;
`packages/api` (the wire types, types only); `packages/auth` (better-auth composition);
`packages/cli` (`circi upload`); `packages/config` (environment parsing); `packages/testing`
(PGlite test database and seeders); `packages/ui` (design system: Base UI parts, CSS modules,
`var(--circi-…)` tokens, one `Name.tsx` + `Name.module.css` per component). Dependencies point
downwards; `core` and `api` depend on nothing.

Rules (all enforced by `packages/services/test/layers.test.ts`; the lint overrides in
`.oxlintrc.json` catch the plain cases earlier; a file that breaks one on purpose is a named
exception in the test, with its reason):

- **`@circi/db` subpaths say the layer.** The root is the connection, errors and shared types;
  import `@circi/db/queries`, `/repositories`, `/queue` or `/schema` for the rest. Apps (http, cli,
  worker) use `@circi/db/queries` and types only: never repositories, the queue, the schema,
  `drizzle-orm` or `pg`. The composition root is the one app folder that wires the database.
- **Repositories store and look up, nothing else.** They never queue jobs or notices (the layers
  test fails if one imports `queue/`); a repository that changes something returns what happened
  (see `recordReview`'s `changed`) and the caller decides what follows. Rules that need no
  database (limits, outcomes, baselines) belong in `@circi/core`.
- **Services own every change that triggers something** (`finalizeBuild`, `reviewBuild`, ...): the
  service opens the transaction, passes it to repositories, and queues the jobs and notices, so a
  webhook delivery or check run exists exactly when the change is committed. A service file that
  calls a mutating repository function must have a transaction in sight (exceptions: the build
  pipeline in `services/src/pipeline`, idempotent step by step so no connection is held across
  image work; `notify` and `queueIntegrationEvent`, which run in the caller's transaction).
  Services import no app, fastify, auth, api or config.
- **Read models** (`db/queries/`) are shaped for the dashboard; their return types must fit
  `@circi/api` (`apps/server/src/contract-check.ts` fails to typecheck if they drift). Routes may
  call them directly, they do not go through services.
- **Routes decide no roles** (no literal `owner`/`admin`: use the policies in `services/src/access`),
  nothing outside config reads `process.env` (also `main.ts`, `composition/runtime.ts`, the CLIs),
  and a route file stays under 250 lines.
- `core` imports no `@circi` package and no I/O; `providers`, `storage`, `sites`, `diff` and
  `config` import at most `core`; `db` imports none of services, integrations, providers, storage,
  auth, api; `auth` imports no service or app; `integrations` import no db, services or fastify
  and their errors carry no HTTP status; the web app imports no server package.
- **Better-auth's tables** (`schema/auth.ts`) are generated (`pnpm db:auth-schema`, then
  `pnpm db:generate`), never edited by hand. Writes to them go through better-auth's API.
- **Fastify scopes** receive exactly their dependencies. Register a scope with a prefix through a
  wrapper plugin (see `app.ts`) so the plugin's options never carry `prefix`.

Where does new code go? A new endpoint: the route in `apps/server/src/http/routes/<area>/`, the
use case in `packages/services/src/<area>/` (export it from that folder's `index.ts`; the package
`index.ts` is one `export *` line per area), the read model in `packages/db/src/queries/`, the
store in `packages/db/src/repositories/`, the wire type in `packages/api`. A new background job: a
body in `services/src/jobs/` or the area folder, a thin adapter in `apps/worker/src/handlers/`,
never a new job name or payload key without a rolling-deploy plan (queued rows outlive a deploy).
A pure rule: `packages/core`. Services tests mirror the folders under `packages/services/test/`.
Background and the evidence behind these rules: `docs/architecture-review/` (layering.md first).

## Types: namespaces for the types that belong to something

Type-only namespaces (erasable, so they work with `erasableSyntaxOnly` and Node's type stripping):

- A function's input/result types are merged into it: `createBuild.Input`, `finalizeBuild.Result`,
  `planUploads.File`. Use `import type { createBuild }` when only the types are needed.
- A component's props: `export namespace Row { export interface Props { … } }` next to `Row`.
- The API's wire types, one namespace per resource: `Build.Detail`, `Team.Settings`, `Workspace.Domain`
  (`@circi/api`). Dates are ISO strings there.

A namespace must contain only types. Never put a value in one.

## Style

- **Imports:** each package's `package.json` `imports` maps a `#<folder>/*` alias per main folder
  (`#lib/*`, `#features/*`, …). Use it instead of `../../..` climbs; relative `./` stays for
  siblings.
- **CSS modules:** `styles.root`, not `styles['root']` (brackets only for names that aren't
  identifiers).
- **Base UI wrappers:** a component that passes props on to a Base UI part extends
  `<Part>.Props` and forwards them; it never redefines them. With extra props of its own it still
  extends the Base UI props and destructures `{ own, props, ...rest }`.
- **Types:** types with a shared prefix or suffix live in one namespace (`GitProvider.StatusInput`),
  not as separate top-level names.
- **State:** state that changes or is needed across large areas, or is complex, goes in a global
  store (zustand), not scattered `useState`/context. Local, simple UI state stays in `useState`.

## Tests

- Node projects (`apps/{server,worker}/test`, `packages/*/test`) run with real migrations on PGlite
  via `@circi/testing`. Never import another package's `test/` folder.
- Server route tests build the app with `buildServer` and use `app.inject`; sign in through the real
  `/api/auth` endpoints (see `apps/server/test/support/helpers.ts`).
- No `@testing-library/*`. Logic (`*.test.ts`, including `apps/web/test`) runs in Node; components
  get `*.browser.test.tsx` run in headless Chromium through Vitest browser mode
  (`vitest-browser-react`, `page.getByRole`, `userEvent` from `vitest/browser`). Logic goes in
  `api.ts` / `lib/` so it's testable without rendering; page tests render through
  `apps/web/test/support/render.tsx`.
- `e2e/` runs against the real Docker stack (Postgres, LocalStack S3, Mailpit, the built image) with
  `pnpm test:e2e`, never in `pnpm test`; GitHub, the OIDC provider and webhook receivers are host
  fakes. A bug only the real stack finds gets a regression test in its owning package. See
  `e2e/README.md`.
- External services (GitHub, SMTP, OIDC) are faked at their edge; say so when something has only been
  tested against a fake.
