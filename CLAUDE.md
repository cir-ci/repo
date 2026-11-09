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

## Layout and layers

```
apps/server     HTTP routes (http/, shared request helpers in http/lib/), admin CLI, process wiring
                (composition/services.ts composes composition/{startup,server-options,shutdown}.ts, and holds the wiring that needs Deps/providers/auth);
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
- **Integrations** (GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Figma: all of them) are declared once, in
  `packages/integrations/src/<id>.ts`, and listed once in `registry.ts`. Routes (`routes/dashboard/integrations/{connect,mapping,links,oauth}.ts`,
  `integration-webhook.ts` for git hosts, `integrations/issue-trackers.ts` for "Create issue"), the `integration-event` and
  `git-notify` jobs, the catalog and the dashboard's connect form, mapping page and links table are generic and
  read the registry: adding an integration touches no route, table, job or page. `integrations.kind` is not a
  CHECK constraint; the registry validates it. A git host is an integration with the `git` capability: its
  repository is the team's `integration_teams` row, its webhook is one shared route and one shared handler
  (`handleGitEvents` in `@circi/services`) fed normalised events. What an integration attaches to a team or
  build (Figma frames, issues) is a row of `integration_links`. A service queues a domain event once with
  `queueIntegrationEvent`; the worker delivers it. Nothing is custom any more (docs/integration-sdk.md).
- **Better-auth's tables** (`schema/auth.ts`) are generated (`pnpm db:auth-schema`, then
  `pnpm db:generate`), never edited by hand. Writes to them go through better-auth's API.
- **Fastify scopes** receive exactly their dependencies. Register a scope with a prefix through a
  wrapper plugin (see `app.ts`) so the plugin's options never carry `prefix`.

## Web features

- A feature folder in `apps/web/src/features` with more than one `api` file uses an `api/` folder
  (`index.ts` plus one file per concern), as `builds`, `teams`, `instance` and `integrations` do.
- A feature over about 25 files is split by sub-area (`list/`, `settings/`, `components/`, `lib/`) and never
  holds another feature's pages. Settings pages sit with what they configure (`workspace-settings`,
  `reviews/settings`, `team-settings`, `account`); the switchers and settings nav live in `sidebar`.
- `#src/*` is for tests and sub-folders only: flat package sources import siblings with `./`.
- No file reaches into another workspace with a relative path; expose what is shared through `exports`.

## Vocabulary

The code, UI, API, database and docs say **team** (never "project") and **workspace** (never
"organization" or "org"). Third parties keep their own words, and so do we when we talk to them:
a Jira project, a GitLab project, a GitHub organization, a Linear team, a Slack workspace, a
Bitbucket workspace (CirCI fields for it are `bitbucketWorkspace`), a Vitest or Docker Compose
project, Argos's `GET /v2/project`, the `--org` flag of `circi admin` (it takes a workspace slug),
and better-auth's own `organization` API: `/api/auth/organization/…`, `authClient.organization.*`,
the `organizationId` / `organizationSlug` request fields and `activeOrganizationId`. Only
better-auth's *API* keeps the word; its tables and columns are `workspace`, `member.workspace_id`,
`invitation.workspace_id`, `session.active_workspace_id` and `sso_provider.workspace_id`, mapped
through the plugins' `schema` options (`packages/auth/src/plugins/`).

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
