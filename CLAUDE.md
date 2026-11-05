# CirCI: working conventions

Self-hosted visual regression testing (see PLAN.md for the design, README.md for use).

## Commands

Node 26 via nvm, pnpm 12. Before committing: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line. No remote repo yet: commits stay local.

## Layout and layers

```
apps/server     HTTP routes, admin CLI, process lifecycle (services.ts composes startup.ts,
                server-options.ts, shutdown.ts)
apps/worker     background jobs (process-build, webhook delivery, git-notify)
apps/web        the dashboard, organised by feature: src/features/<feature>/{api.ts, *Page.tsx, …}
packages/api    the dashboard API's wire types (types only, one namespace per resource)
packages/auth   better-auth composition: plugins/, hooks/, cookies, admin operations
packages/cli    `circi upload` for CI
packages/config environment parsing
packages/core   pure shared logic (baselines, outcomes, limits, webhook signing); no I/O
packages/db     Drizzle schema, migrations, repositories/, queries/
packages/providers  git host adapters and the text CirCI shows on them (GitHub)
packages/services   the service layer: operations that change several things at once
packages/storage    local-disk and S3 drivers
packages/testing    PGlite test database and seeders, imported as `@circi/testing`
```

Dependencies point downwards: apps → services → db → core; `core` and `api` depend on nothing.

- **`packages/db/repositories/`** store and look up data, nothing else. They never queue jobs or
  notices; a repository that changes something returns what happened (see `recordReview`'s
  `changed`) and lets the caller decide what follows. `packages/services/test/layers.test.ts`
  fails if a repository imports the job queue. Business rules that need no database (limits,
  outcomes, baselines) belong in `@circi/core`.
- **`packages/services`** is the layer apps call for anything that changes a build's state
  (`finalizeBuild`, `completeBuild`, `failBuild`, `requeueBuild`, `reviewBuild`). A service opens
  the transaction, calls repositories (passing the transaction), and queues the jobs and notices
  that follow, so a webhook delivery or check run exists exactly when the change is committed
  (a transactional outbox). Repositories are called directly only for plain reads and simple
  writes that trigger nothing.
- **`packages/db/queries/`** are read models shaped for the dashboard. Their return types must fit
  `@circi/api`; `apps/server/src/contract-check.ts` fails to typecheck if they drift.
- **Better-auth's tables** (`schema/auth.ts`) are generated (`pnpm db:auth-schema`, then
  `pnpm db:generate`), never edited by hand. Writes to them go through better-auth's API.
- **Fastify scopes** receive exactly their dependencies. Register a scope with a prefix through a
  wrapper plugin (see `app.ts`) so the plugin's options never carry `prefix`.

## Types: namespaces for the types that belong to something

Type-only namespaces (erasable, so they work with `erasableSyntaxOnly` and Node's type stripping):

- A function's input/result types are merged into it: `createBuild.Input`, `finalizeBuild.Result`,
  `planUploads.File`. Use `import type { createBuild }` when only the types are needed.
- A component's props: `export namespace Row { export interface Props { … } }` next to `Row`.
- The API's wire types, one namespace per resource: `Build.Detail`, `Project.Settings`, `Org.Domain`
  (`@circi/api`). Dates are ISO strings there.

A namespace must contain only types. Never put a value in one.

## Tests

- Node projects (`apps/{server,worker}/test`, `packages/*/test`) run with real migrations on PGlite
  via `@circi/testing`. Never import another package's `test/` folder.
- Server route tests build the app with `buildServer` and use `app.inject`; sign in through the real
  `/api/auth` endpoints (see `apps/server/test/helpers.ts`).
- Web tests (`apps/web/test`) run in happy-dom. Logic goes in `api.ts` / `lib/` so it's testable
  without rendering.
- External services (GitHub, SMTP, OIDC) are faked at their edge; say so when something has only been
  tested against a fake.
