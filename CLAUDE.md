# CirCI: working conventions

Self-hosted visual regression testing (see PLAN.md for the design, README.md for use).

## Commands

Node 26 via nvm, pnpm 12. Before committing: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
What emits what: `tsc` only type-checks (`pnpm typecheck`, `noEmit`). `pnpm build` runs tsdown for
`@circi/ui` (`dist`, browser), `@circi/cli` and `@circi/vitest` (published, `dist`) and `apps/server`
(one bundle for the image), then Vite for `apps/web`. The other packages have no build: their
`exports` point at `src/*.ts`, which Node, Vitest, Vite, tsc and tsdown all read directly.
Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line. No remote repo yet: commits stay local.

## Layout and layers

```
apps/server     HTTP routes (http/, shared helpers in http/lib/), admin CLI, process lifecycle
                (lifecycle/services.ts composes lifecycle/{startup,server-options,shutdown}.ts);
                built with tsdown into one bundle for the image (deploy/README.md)
apps/worker     background jobs (process-build, webhook delivery, git-notify, integration-event); no build, the server bundle inlines it
apps/web        the dashboard: src/app/ (router, shell, sidebar), src/lib/ (http, auth client, shared bits),
                src/features/<feature>/{api.ts, *Page.tsx, …}
packages/api    the dashboard API's wire types (types only, one namespace per resource)
packages/auth   better-auth composition: plugins/, hooks/, sso/, operations/ (admin, accounts, setup), cookies
packages/cli    `circi upload` for CI
packages/config environment parsing
packages/core   pure shared logic (baselines, outcomes, limits, webhook signing); no I/O
packages/db     Drizzle schema, migrations, repositories/, queries/
packages/integrations  the integration SDK: one `IntegrationDefinition` per integration (`src/<id>.ts`),
                one registry (`registry.ts`), the generic catalog, mapping rules and errors; see
                docs/integration-sdk.md. Depends on core, api (types) and providers, never on db
packages/providers  clients of external services (git hosts, Slack, Figma, trackers) and the text CirCI shows on them
packages/services   the service layer: operations that change several things at once
packages/storage    local-disk and S3 drivers
packages/testing    PGlite test database and seeders (src/seed/), imported as `@circi/testing`
packages/ui         the design system: Base UI parts styled with CSS modules and `var(--circi-…)`
                    tokens, light and dark; one `Name.tsx` + `Name.module.css` per component
```

Dependencies point downwards: apps → services → db → core, and services → integrations → providers → core;
`core` and `api` depend on nothing, and `db` and `integrations` never import each other.

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
- **Integrations** (Slack so far; the rest are being migrated) are declared once, in
  `packages/integrations/src/<id>.ts`, and listed once in `registry.ts`. Routes (`integrations-generic.ts`),
  the `integration-event` job, the catalog and the dashboard's connect form and mapping page are
  generic and read the registry: adding an integration touches no route, table, job or page.
  `integrations.kind` is not a CHECK constraint; the registry validates it. A service queues a
  domain event once with `queueIntegrationEvent`; the worker delivers it. What is not migrated yet
  (git hosts, Linear, Jira, Figma) keeps its own route file and page until its definition exists.
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
