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
packages/storage    local-disk and S3 drivers
packages/testing    PGlite test database and seeders, imported as `@circi/testing`
```

Dependencies point downwards: apps → packages; `core` and `api` depend on nothing.

- **`packages/db/repositories/`** write and look up data. A repository function may enqueue jobs
  (webhook delivery, git notifications) *inside its own transaction*: that is deliberate (a
  transactional outbox), because the job must exist exactly when the change is committed.
  Business rules that need no database (limits, outcomes, baselines) belong in `@circi/core`.
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
