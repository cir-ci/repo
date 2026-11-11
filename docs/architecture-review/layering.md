# Layered server architecture: review and plan

Scope: `apps/server`, `apps/worker`, `packages/{services,db,core,integrations,providers,auth,config,storage,sites,diff,api}`.
Read-only analysis of the tree as it stood on 2026-11-09. Numbers come from `wc -l`, `grep` and a small script that
classified every name the server imports from `@circi/db` as a query (`db/src/queries`) or a repository (`db/src/repositories`).

## 1. Where the code is today

### 1.1 Size per area (non-test `.ts`/`.tsx` under `src`)

| Area | Files | Lines | Notes |
| --- | ---: | ---: | --- |
| `packages/db` | 78 | 10,640 | 29 repositories, 20 queries, 25 schema files. 30% of all server-side code |
| `apps/server` | 78 | 7,714 | `http/` 65 files (44 routes, 13 lib, 5 hooks), `lifecycle/` 7, `cli/` 4 |
| `packages/providers` | 14 | 2,494 | git host and tracker HTTP clients plus the text shown on them |
| `packages/services` | 17 | 2,088 | the application layer; flat, one file per area |
| `packages/integrations` | 17 | 2,008 | the integration SDK (definitions per vendor) |
| `packages/core` | 25 | 1,373 | pure rules |
| `apps/worker` | 10 | 1,223 | `runner.ts` 416, `jobs/` 6 files |
| `packages/auth` | 20 | 1,214 | better-auth composition and operations |
| `packages/config`, `storage`, `sites`, `diff` | 2, 5, 6, 1 | 527, 481, 502, 188 | leaf packages, import no `@circi/*` |

The domain/application layers are thin and the persistence layer is fat. Routes plus db together are 18k lines;
services plus core are 3.5k.

### 1.2 Biggest files (the mixed ones)

| File | Lines | Why it is big |
| --- | ---: | --- |
| `apps/server/src/http/routes/dashboard/integrations-generic.ts` | 723 | 12 routes: OAuth state signing, secret sealing, role checks, mapping rules, 11 db functions and 4 services |
| `apps/server/src/cli/admin.ts` | 611 | 14 db bindings, services, auth operations, console output, all in one command table |
| `packages/db/src/repositories/builds.ts` | 595 | the build state machine's persistence |
| `packages/db/src/repositories/sites.ts` | 537 | sites storage and sessions |
| `packages/config/src/index.ts` | 485 | env parsing plus warnings plus `ConfigError` |
| `apps/worker/src/runner.ts` | 416 | claim loop, LISTEN/NOTIFY, retry policy and five `run*Job` adapters in one file |
| `packages/db/src/queries/insights.ts` | 410 | read model with aggregation rules |
| `packages/services/src/reviews.ts` | 372 | the best-shaped use-case file; still holds auto-approve and bulk logic |
| `apps/server/src/http/routes/dashboard/settings.ts` | 311 | 17 db bindings, role gate, webhook validation, GitHub link flow |
| `apps/server/src/http/lib/github-app.ts` | 273 | GitHub App manifest credential store and TTL cache: lives in `http/lib`, is called from `lifecycle/` and `cli/` |

### 1.3 Who imports whom (measured, `from '@circi/…'` counts in `src`)

```
apps/server   -> db 55, api 25, auth 19, core 17, services 15, integrations 10, storage 9, config 7, providers 6, sites 4, worker 1
apps/worker   -> db 9, services 4, core 4, storage 3, integrations 3, providers 2, diff 1
services      -> db 15, core 10, integrations 5, storage 1
db            -> core 24
auth          -> db 12, core 1
integrations  -> providers 10, core 9, api 1
core, providers, storage, sites, diff, config -> nothing
```

The package graph has no cycles. `import/no-cycle` is on in `.oxlintrc.json`, and `layers.test.ts` already pins a few edges:
repositories do not import the outbox files (except `jobs.ts`, `webhooks.ts`, `git.ts`), `integrations` does not import
`db`/`services`/`worker`, and `db`/`core`/`providers` do not import `integrations`.

What no test or rule pins: anything about `apps/server` and `apps/worker`. That is where the layering is weakest.

### 1.4 Findings (evidence)

**F1. Routes bypass the application layer for writes.**
`apps/server/src` imports 129 distinct values from `@circi/db`: 29 queries (fine, read models), 91 repository functions
and a few others. 42 server files call repository functions. 25 of those are mutating: `createWebhook`, `updateProjectSettings`,
`setWorkspaceSettings`, `createReviewRule`, `addWorkspaceDomain`, `replaceIntegrationCredentials`, `setProjectAppearance`,
`markFileVerified`, `setParallelTotal`, `setSetting`, and so on. `grep transaction(` in `apps/server` returns 0 and in
`packages/services/src` 32 (8 files), so every one of those writes is a bare single statement that cannot join an outbox
transaction. They are "simple writes that trigger nothing" today, which is exactly the CLAUDE.md allowance; the cost is that
the rule is enforced only by memory. Adding a webhook event or an audit entry to any of them means moving the write first.
36 of 44 route files import `@circi/db`; 14 import `@circi/services`.

**F2. Routes embed schema and SQL.**
`routes/dashboard/workspace-sso.ts` lines 67-69 and 120-122 run `select … from schema.ssoProvider where …` with drizzle
operators directly in the handler. `routes/dashboard/triage.ts` and `ignore-regions.ts` import `schema` for
`schema.TRIAGE_KINDS` (a constant that belongs in `core`). `http/lib/instance-settings.ts` reads `schema.projects.retentionDays.default`
to learn a default. `packages/services/src/git-events.ts` also imports `schema` for `schema.REVIEW_SOURCES`. The db package
exports its whole schema, so any layer can reach for it.

**F3. Authorization is duplicated per transport and mixes into replies.**
`http/lib/project-access.ts` (`loadProject`) and `http/lib/workspace-access.ts` (`loadWorkspace`) resolve the actor's membership,
decide 404 vs 403 and write the HTTP reply, so the policy is welded to Fastify. The role rule `owner || admin` is re-implemented
in 13 other files (18 occurrences of `role === 'owner'`/`!== 'owner'`): `settings.ts` (lines 160-167), `rules.ts`, `domains.ts`,
`workspaces.ts`, `comments.ts`, `integrations.ts`, `integrations-generic.ts`, `workspace-sso.ts`, `workspace-auth.ts`,
`workspace-settings.ts`, `github-app.ts`, `cli/admin.ts` and `apps/web/src/features/members/model.ts`. The CLI (`admin.ts`) and
the HTTP API therefore each carry their own copy of "who may do this", and a job or a future second transport could not reuse
either. `getMemberRole`/`getProjectMemberRole`/`findProjectForMember` are called from `http/lib`, so repository functions double
as policy inputs.

**F4. Use cases live in the worker.**
`apps/worker/src/jobs/process-build.ts` (208 lines) is the main use case of the product: resolve baseline (`resolveBaseline`),
pair screenshots, diff images, write thumbnails, replace diff rows, then call `completeBuild`. It calls 13 repository functions
and `diff`/`storage` directly, and the worker imports `@circi/db` in 9 places against 4 for `@circi/services`. `notify-git.ts`,
`deliver-webhook.ts`, `integration-event.ts`, `send-email.ts` each call repositories directly. `services` cannot run a build
without the worker, and the HTTP server cannot unit-test "process a build" without importing the worker (it does:
`lifecycle/services.ts` imports `startWorker` from `@circi/worker`, the only app-to-app edge).

**F5. Infrastructure and composition live in the transport layer.**
`http/lib/github-app.ts` (273 lines, secret sealing, settings storage, a TTL cache, `useStoredGithubApp`) is imported by
`lifecycle/services.ts` and by `cli/admin.ts`, so the CLI imports from `http/`. `http/lib/integration-context.ts`,
`http/lib/install-state.ts` and `http/lib/instance-settings.ts` do the same job of "build what the integrations need".
`lifecycle/doctor.ts` (144 lines) performs HTTP probes and is called by both `cli/admin.ts` and a route. `lifecycle/integration-config.ts`
maps config to definitions; the worker needs that mapping too.

**F6. The job queue is a repository.**
The queue (`db/src/repositories/jobs.ts`, plus the `webhooks.ts` and `git.ts` outbox writers) is an infrastructure adapter with
its own semantics (claim, lock, retry, `LISTEN`). It is reached by the worker through `@circi/db` (`runner.ts` imports
`claimJob`-style functions) and by services to enqueue. `layers.test.ts` has a hard-coded `OUTBOX = {'jobs.ts','webhooks.ts','git.ts'}`
allow-list: the rule "repositories never queue" has three named exceptions because the queue was never given a home of its own.

**F7. Read models import repositories.**
10 of 20 files in `db/src/queries` import `#repositories/…` (`insights`, `integrations`, `figma`, `search`, `storage`, `inbox`,
`triage`, `projects`, `activity`, `workspace-builds`). Reads should depend on schema and shared SQL helpers, not on the write side.

**F8. Errors have three homes and a hand-written mapper.**
`ValidationError` is in `core/errors.ts`; `NotFoundError`, `ConflictError`, `ForbiddenError`, `pgErrorCode` are in `db/errors.ts`
(so `core`-level concepts live in persistence, and `http/lib/errors.ts` needs both packages); `IntegrationError` and its subclasses
carry an HTTP `status` field (`400|404|409|502`) inside the SDK, i.e. an HTTP concept inside a transport-free package; storage,
diff, providers and config each define their own. `http/lib/errors.ts` (29 lines) maps four classes, and `integrations-generic.ts`
and `settings.ts` catch `IntegrationError` by hand to translate it again.

**F9. Validation is per route and partly duplicated.**
Zod schemas are inline in route files (`kindParams`, `idParams`, `ref`, `repoRef` regex in `settings.ts:73`). `http/lib/validation.ts`
is 13 lines. `core` has `build-filters.ts` and `http/lib/build-filters.ts` exists too. Inputs to services are typed but not validated
by the service, so the CLI (`admin.ts`) has its own validation.

**F10. Layering tests cover only part of the rules.**
`packages/services/test/layers.test.ts` asserts one repository rule and four integrations-SDK rules. Nothing asserts: routes do not
import repositories or `schema`; services do not import apps; `core` imports nothing; `providers` imports only `core`; `auth` does not
import `services`; the worker uses services for writes. The dependency direction in CLAUDE.md is currently a convention.

### 1.5 What is already good (keep it)

- `services` is the one place with transactions and the outbox (`finalizeBuild`, `completeBuild`, `failBuild`, `requeueBuild`,
  `reviewBuild`, 32 `transaction(` calls) and has its own tests (20 files in `packages/services/test`).
- `db/queries` return types are checked against `@circi/api` by `apps/server/src/contract-check.ts`.
- Fastify scopes receive exactly their `Deps` (`http/lib/deps.ts` has `Base`, `Instance`, `V1`, `Dashboard`, `Sites`).
- `core` and the leaf packages import nothing, so they are cheap to test and reuse.
- The 34 test files for routes use `buildServer` + `app.inject`, which survive any internal move as long as the route table is unchanged.

## 2. Target architecture

Six layers. Each is a folder or a package; a layer may import only from layers listed below it.

```
L5  transport     apps/server/src/http, apps/server/src/cli, apps/worker/src (job handlers)
                  Parse input, authenticate, call ONE use case, map the result/errors to HTTP/exit code/job outcome.
L4  application   packages/services (use cases) + packages/services access policies
                  One function per intent. Owns the transaction, authorization, and the outbox. Same code for HTTP, CLI and worker.
L3  domain        packages/core (+ errors)
                  Pure rules and value types: baselines, outcomes, limits, rules, tokens, signing. No I/O, imports nothing.
L2  persistence   packages/db: schema/, repositories/ (writes + lookups), queries/ (read models), queue/ (the job table)
                  Drizzle only. Never calls a service, never queues, never decides policy.
L1  adapters      packages/{providers, storage, integrations(vendor defs), auth(better-auth), sites, diff, mail}
                  Talk to the outside world through interfaces declared in the layer above that needs them.
L0  platform      packages/config, logging, apps/*/composition (lifecycle)
                  Config parsing and the composition root that wires concrete adapters into use cases.
```

### 2.1 The dependency rule

Source dependencies point downward only: `transport -> application -> {domain, persistence, adapters}`;
`persistence -> domain`; `adapters -> domain` (or nothing). Concretely:

1. `core` imports no `@circi/*` and no node I/O. (Already true.)
2. `db` imports only `core`. Repositories and queries import `schema`, never services, jobs (except the queue module) or adapters.
3. Adapters (`providers`, `storage`, `sites`, `diff`, `config`) import at most `core`. `integrations` imports `core`, `providers`, `api`.
4. `services` imports `core`, `db`, `integrations`, `storage`, `providers`, `diff` and nothing from `apps/*`, `auth`, or `api`
   (it uses its own result types; `api` is a wire concern).
5. `apps/server/http` imports `services`, `api`, `core`, `config`, `auth`, and the `queries` entry of `db` only.
   It never imports `repositories`, `schema`, `drizzle-orm`, or `pg`.
6. `apps/worker` imports `services` and adapters. It does not import `repositories`.
7. `apps/server` never imports `apps/worker`; both are composed in a thin `apps/runtime` entry or in `apps/server/src/main.ts`
   using the worker's public `start` function from a package, not an app (see 2.6).

Reads are the one allowed shortcut (CQRS-lite): `http` may call `db/queries` read models directly, because they are
shaped for the API and carry no rules. Everything that changes state or enforces who may see or do something goes through
`services`.

### 2.2 Layer responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| transport (`http/routes`) | URL, method, zod params/body, session/token lookup, status codes, serialisation to `@circi/api` shapes | role checks, SQL, transactions, retries, sealing secrets |
| transport (`cli`) | argument parsing, console output | business rules |
| transport (`worker` handlers) | job payload parsing, retry/backoff outcome | what a build, webhook or notice means |
| application (`services`) | use cases, `Actor` authorization, transactions, outbox, orchestrating adapters, idempotency | HTTP, Fastify types, console, process lifecycle |
| domain (`core`) | rules, errors, constants, schemas of value objects | database, network, time (take `now` as an argument) |
| persistence (`db`) | tables, migrations, repositories, read models, the job table | decisions, queueing from repositories, vendor knowledge |
| adapters | one external system each | knowing about projects, builds or users |
| platform | config, logging, composition root | domain behaviour |

### 2.3 Cross-cutting concerns

**Auth and access control.**
Authentication stays in transport (`http/hooks/session.ts`, `project-token.ts`; `packages/auth` is an adapter). Authorization moves into the
application layer as policies that take an `Actor` and throw domain errors:

```ts
// packages/services/src/access/actor.ts
export type Actor =
  | { kind: 'user'; id: string; method: SessionMethod }
  | { kind: 'ciToken'; projectId: string }
  | { kind: 'system' }            // worker, CLI with --admin
// packages/services/src/access/policies.ts
export async function requireWorkspaceMember(tx, actor, workspaceSlug): Promise<WorkspaceScope>   // throws NotFoundError
export async function requireProjectMember(tx, actor, ref): Promise<Projectscope>                         // throws NotFoundError
export async function requireProjectManager(tx, actor, ref): Promise<Projectscope>                        // + ForbiddenError
export async function requireWorkspaceAdmin(tx, actor, workspaceSlug): Promise<WorkspaceScope>
export async function requireInstanceAdmin(tx, actor): Promise<void>
```

The 404-for-non-members rule (`project-access.ts`) and the `owner || admin` rule (13 files today) then exist once, with one test file.
`loadProject`/`loadWorkspace` shrink to "read params, call a policy, hand the scope to the handler"; the reply-writing disappears
because the error mapper does it.

**Transactions and the outbox.**
Only L4 opens transactions: `const result = await withTransaction(db, async (tx) => …)` (a 5-line helper in `services/src/tx.ts`
over `db.transaction`). Repositories take `tx: Database | Transaction` as the first argument (already the pattern). The queue writers
(`jobs`, `webhooks`, `git` outbox files) move to `db/src/queue/` and are importable only from `services`. Every use case that
changes state returns `{ …result, effects }`-free data; the outbox rows are inserted inside the same `tx`. Rule: a function in
`services/src/**` that calls a mutating repository either opens the transaction or takes `tx` as a parameter, never both.

**Errors to HTTP.**
One `errors` module in `core`: `DomainError` base with a `code` (`validation`, `not_found`, `forbidden`, `conflict`,
`unreachable`, `precondition`) and no HTTP vocabulary. `ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError` move there
(re-exported from `db` for one release, then removed). `IntegrationError` extends `DomainError` and drops its `status` field; the SDK maps
`InvalidCredentials -> validation`, `Unreachable -> unreachable`, `Conflict -> conflict`. `http/lib/errors.ts` holds the single
`code -> status` table (400, 404, 403, 409, 502, 422); the CLI maps `code -> exit code`; the worker maps `code -> retry or fail`.
Route-local `try/catch (IntegrationError)` blocks in `integrations-generic.ts` and `settings.ts` go away.

**Config.**
`@circi/config` parses `process.env` once in `createRuntime` (L0). Layers below receive plain values via constructors/`Deps`
(they do today). Rule: `process.env` appears only in `config`, `apps/*/main`, `lifecycle/runtime.ts` and the CLI entry
(today: `lifecycle/services.ts:128` reads `CIRCI_WEB_DIST`; move it into config).

**Logging.**
A `Logger` interface (pino-compatible: `info/warn/error(obj, msg)`) is declared in `core` and passed into use cases that need it
via `Deps`. Routes use `req.log`, which is a child of the same logger. No `console.*` outside `cli/output.ts`.

**Validation schemas.**
Three kinds, three homes: (a) wire shapes (body/params/query) next to the route in `http/routes/<area>/schemas.ts`; (b) value-object
constraints that are rules (slug, repo ref `owner/name`, webhook events, `TRIAGE_KINDS`, `REVIEW_SOURCES`) in `core`, so the route, CLI and
service share one regex; (c) invariants enforced by the service (it validates what it must not trust, e.g. limits) and throws
`ValidationError`. Zod stays in transport and `core`; services do not parse HTTP.

### 2.4 Folder structure (target)

```
apps/server/src
  main.ts
  http/
    app.ts                 buildServer (scopes), hooks registration
    hooks/                 session, same-origin, project-token, instance-admin, previous-hosts   (unchanged)
    routes/
      dashboard/<area>/    one folder per resource: routes.ts, schemas.ts, presenters.ts   (replaces 31 flat files)
      v1/  argos/  auth.ts  health.ts  webhooks/
    plugins/               error-handler.ts (code->status), scope-deps.ts, params.ts
    sites/                 static site serving (transport)
  cli/                     commands/<group>.ts (admin split), output.ts
  composition/             was lifecycle/: runtime, services (wiring), startup, shutdown, server-options, doctor
apps/worker/src
  index.ts                 public start()
  runner.ts                claim loop + retry only (~150 lines)
  handlers/                one thin file per job kind: parse payload, call a service
packages/services/src      application layer
  access/                  actor.ts, policies.ts
  builds/ (create, finalize, complete, fail, requeue, process)
  reviews/  comments/  projects/  workspaces/  integrations/  git/  notifications/  retention/  triage/  views/  sites/  settings/
  tx.ts  index.ts
packages/core/src          domain: errors.ts, rules/, baselines/, outcome/, limits/, tokens/ (grouped, no I/O)
packages/db/src
  schema/  client.ts
  repositories/            store and look up
  queries/                 read models (import schema/helpers only)
  queue/                   jobs.ts, webhooks.ts, git.ts outbox writers + claim/lock
packages/{providers,storage,sites,diff,config,auth,integrations}   adapters (unchanged shape)
```

### 2.5 Current path to target path

| Current | Target | Kind |
| --- | --- | --- |
| `apps/server/src/http/routes/dashboard/integrations-generic.ts` (723) | `routes/dashboard/integrations/{routes,oauth,mappings,schemas}.ts` + `services/src/integrations/{connect,mappings}.ts` | split |
| `apps/server/src/http/routes/dashboard/settings.ts` (311) | `routes/dashboard/project-settings/{routes,webhooks,git-link}.ts`; webhook validation to `core/rules/webhook-events.ts`; writes to `services/src/projects/*` | split |
| `routes/dashboard/{rules,domains,workspace-settings,workspace-auth,workspace-sso,github-app}.ts` | `routes/dashboard/<area>/routes.ts`; writes to `services/src/{rules,workspaces,settings}/…`; the SQL in `workspace-sso.ts` to `db/queries/sso.ts` | move + extract |
| `routes/dashboard/{views,comments,reviews,triage,inbox,workspaces,projects,issue-trackers}.ts` | same, now one call into services each | thin out |
| `routes/v1/*`, `routes/argos/index.ts` (276) | `routes/v1/`, `routes/argos/` (argos split in `builds.ts` + `files.ts`) | split |
| `http/lib/project-access.ts`, `workspace-access.ts` | `services/src/access/policies.ts` + `http/plugins/params.ts` (reads params, calls policy) | split |
| `http/lib/errors.ts` | `http/plugins/error-handler.ts` | rename |
| `http/lib/github-app.ts` (273) | `services/src/settings/github-app.ts` (store + cache) and `composition/github-app-sync.ts` | move down |
| `http/lib/{integration-context,install-state,instance-settings}.ts` | `services/src/integrations/context.ts`, `services/src/settings/instance.ts` | move down |
| `http/lib/{build-filters,presenters,pages,streams,validation}.ts` | `http/plugins/` or `core/build-filters.ts` (merge with existing `core/src/build-filters.ts`) | merge |
| `http/lib/deps.ts` | `http/plugins/scope-deps.ts` | rename |
| `lifecycle/{runtime,services,startup,shutdown,server-options,integration-config}.ts` | `composition/` (same files); `startWorker` imported from `@circi/worker` as a package | rename |
| `lifecycle/doctor.ts` | `services/src/diagnostics/doctor.ts` (probe injected) + `composition/doctor-fetch.ts` | split |
| `cli/admin.ts` (611) | `cli/commands/{accounts,workspaces,projects,storage,retention,diagnostics}.ts` calling services with `Actor.system` | split |
| `apps/worker/src/jobs/process-build.ts` (208) | `services/src/builds/process.ts`; `worker/handlers/process-build.ts` (10 lines) | move down |
| `apps/worker/src/jobs/{notify-git,deliver-webhook,integration-event,send-email,review-sweep}.ts` | `services/src/{git,webhooks,integrations,notifications}/deliver*.ts` + thin `worker/handlers/*` | move down |
| `apps/worker/src/runner.ts` (416) | `runner.ts` (claim/retry) + `handlers/index.ts` (job kind -> handler) | split |
| `apps/worker/src/lib/{files,concurrency}.ts` | `services/src/builds/files.ts`, `core/concurrency.ts` | move |
| `packages/services/src/*.ts` (17 flat) | `services/src/<area>/*.ts` (as in 2.4) | group |
| `packages/db/src/repositories/{jobs,webhooks,git}.ts` | `packages/db/src/queue/` | move |
| `packages/db/src/queries/*` importing `#repositories` (10 files) | import shared helpers from `db/src/shared/` | untangle |
| `packages/db/src/errors.ts` (`NotFoundError`, `ConflictError`, `ForbiddenError`) | `packages/core/src/errors.ts` (keep `pgErrorCode` in db) | move up |
| `packages/integrations/src/errors.ts` | same, minus `status`; mapping in `http/plugins/error-handler.ts` | edit |
| `schema.TRIAGE_KINDS`, `REVIEW_SOURCES`, retention default | `core/src/{triage,review-sources,limits}.ts`; `db/schema` imports them | move up |
| `packages/auth` | unchanged; `operations/` called only from services or transport | keep |
| `packages/{providers,storage,sites,diff,config,api,cli,ui,vitest,testing}` | unchanged | keep |

### 2.6 What gets merged and what is split

Merged: the three access spellings (`loadProject`, `loadWorkspace`, 13 inline role checks) into `services/src/access`; the three
error homes into `core/errors.ts`; `http/lib/build-filters.ts` into `core/build-filters.ts`; `lifecycle/` renamed `composition/` (it is
a composition root, not a lifecycle); the two worker lib files into their natural owners.

Split: `integrations-generic.ts`, `settings.ts`, `cli/admin.ts`, `runner.ts`, `process-build.ts` (pure part to `core`, orchestration to
services), `reviews.ts` (372; auto-approve and bulk into `reviews/auto-approve.ts`, `reviews/bulk.ts`), `db/repositories/builds.ts` (595; state
transitions vs lookups) and `sites.ts` (537; tokens, sessions, files).

Worker and server sharing: both are L5 transports for the same application layer. The worker package exports `startWorker(deps)`
and nothing else; `apps/server` composes it through the package API, not by importing an app (today's `@circi/worker` import in
`lifecycle/services.ts` is acceptable once `@circi/worker` is a library with a narrow `index.ts`; the rule is "no importing `apps/*/src`
internals"). A job handler is a function `(deps: { db, storage, providers, logger }, payload) => Promise<Outcome>` that calls one use case.
`Actor.system` identifies jobs in policies and audit logs.

## 3. Naming conventions

- Use cases are verbs: `createBuild`, `requeueBuild`, `reviewBuild`, `updateProjectSettings`, `connectIntegration`. One exported function per intent;
  its types are merged into it (`updateProjectSettings.Input`), as CLAUDE.md prescribes.
- File per area under `services/src/<area>/`; file name is the noun or intent (`process.ts`, `bulk.ts`), never `utils.ts` or `helpers.ts`.
- Repositories: `get*` (one or throws `NotFoundError`), `find*` (one or `undefined`), `list*` (many), `create|insert*`, `update|set*`, `delete|remove*`,
  `record*` (append-only). Queries: `list*`/`get*` only and named after the screen (`listBuildsForProject`).
- Policies: `require*` (throws), `can*` (returns boolean, used by presenters).
- Routes: `<area>/routes.ts` exports `<area>Routes: FastifyPluginAsync<Deps.X>`; schemas in `<area>/schemas.ts`; no `-generic` suffixes
  (the integrations-generic name itself is a layering smell: the generic one is now the only one).
- Worker: `handlers/<job-kind>.ts` exports `handle<JobKind>`.
- Imports: `#<folder>/*` aliases (existing convention); add `#access/*`, `#queue/*` in the relevant packages.
- Package entries: `@circi/db` is split into subpath exports `@circi/db` (client, types, errors re-export), `@circi/db/queries`,
  `@circi/db/repositories`, `@circi/db/queue`, `@circi/db/schema`; this is what makes the rules in section 4 one-line checks.

## 4. Enforcement

Today only `packages/services/test/layers.test.ts` enforces anything (5 tests, text greps over source). Extend it into a real
dependency test and add a lint rule so the failure shows in the editor.

### 4.1 `layers.test.ts` assertions (add)

Implement a `importsOf(dir, patterns)` helper that also resolves `#alias/*` and relative imports (the current one matches only `@circi/…`).
Assert each of these returns `[]`:

| # | Scope (files) | Must not import | Evidence it matters |
| - | --- | --- | --- |
| 1 | `packages/core/src` | any `@circi/*`, `node:fs|net|http`, `drizzle-orm`, `pg` | stays pure |
| 2 | `packages/{providers,storage,sites,diff,config}/src` | any `@circi/*` other than `core` | all five import none today |
| 3 | `packages/db/src` | `@circi/{services,integrations,providers,storage,auth,api}` | today imports only `core` (24) |
| 4 | `packages/db/src/queries` | `#repositories/*` | 10 files violate now; fix in step 6, then enable |
| 5 | `packages/db/src/repositories` | `#queue/*` (after the move) | replaces the `OUTBOX` allow-list |
| 6 | `packages/services/src` | `apps/*`, `fastify`, `@circi/{auth,api,config}`, `drizzle-orm` `sql|eq|and` outside `tx.ts` | services imports only db/core/integrations/storage today |
| 7 | `packages/services/src/**` mutating repository calls | calls outside a function that has `withTransaction` or a `tx` param | statically: any file that imports a mutating repo name must also contain `tx` or `withTransaction` (heuristic, review exceptions in a list) |
| 8 | `apps/server/src/http`, `apps/server/src/cli`, `apps/worker/src` | `@circi/db/repositories`, `@circi/db/schema`, `drizzle-orm`, `pg`, `#queue/*` | today: 91 repo functions, 3 files with `schema`, 1 with drizzle ops |
| 9 | `apps/server/src/http` | `apps/worker`, `@circi/db/queue` | |
| 10 | `apps/worker/src` | `@circi/db/repositories` except an explicit allow-list of the claim loop (`runner.ts`) | worker imports db in 9 places |
| 11 | `packages/auth/src` | `@circi/services`, `apps/*` | auth sits beside adapters |
| 12 | `packages/integrations/src` | `@circi/{db,services}`, `fastify`; and no `status:` field on errors | the existing rule plus F8 |
| 13 | `**/src` (non-test) | `process.env` outside `packages/config`, `*/main.ts`, `composition/runtime.ts`, `cli` | `lifecycle/services.ts:128` |
| 14 | `apps/server/src/http/routes/**` | role literals `'owner'` and `'admin'` | 18 occurrences now; target 0 |
| 15 | every `*.ts` in `routes/` | more than 250 lines | today `integrations-generic.ts` 723, `settings.ts` 311, `reviews.ts` 284 |

Tests 4, 8, 14 and 15 start red: land each in the same step that fixes its violations, or start with a ratchet
(`const KNOWN = [...]`, test fails when the list grows or when an entry no longer violates). The ratchet is the default for
anything with more than 5 offenders, so every step stays green.

### 4.2 Lint (oxlint) additions in `.oxlintrc.json`

`import/no-cycle` stays. Add an `overrides` block per layer using `no-restricted-imports` (oxlint supports it):

- `packages/core/**`: patterns `@circi/*`, `drizzle-orm`, `pg`, `node:*` except `node:crypto`.
- `apps/*/src/**` and `packages/services/**`: pattern `@circi/db/repositories`, `@circi/db/schema` allowed only in `services` (override reversing it for `packages/services/**`).
- `packages/db/src/queries/**`: pattern `#repositories/*`.
- `apps/server/src/http/routes/**`: `drizzle-orm`, `fastify` is fine, `@circi/db/*` except `/queries`.

Keep both: the test is the source of truth in CI (it understands `#alias`), lint gives the editor feedback.

### 4.3 Other checks

- `contract-check.ts` keeps guarding query-to-API drift; add a twin that asserts each service's `Result` type fits `@circi/api` where the route returns it directly.
- A policy test matrix in `services/test/access.test.ts`: member / non-member / admin / owner / CI token / system against each `require*`.
- A route table snapshot (`app.printRoutes()`) in `apps/server/test` so moves cannot change URLs silently.
- Add a short "Layers" section to `CLAUDE.md` once step 1 lands (this file does not edit it).

## 5. Migration plan

Ordering principle: add the enforcement first as a ratchet, then move code down, shrinking the ratchet lists as you go.
Every step ends with `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No step changes a URL, a wire type
or a migration. Sizes: S under half a day, M about a day, L two or more days. Steps marked (P) split into agents with disjoint files.

### Step 0. Safety net (S)
Files: new `apps/server/test/http/route-table.test.ts` (snapshot of `app.printRoutes()`), nothing else.
Stays passing: all. Purpose: URL stability proof for every later step.
Risk: snapshot churn if another agent adds routes; regenerate once at the start of each step.

### Step 1. Dependency ratchet (S)
Files: `packages/services/test/layers.test.ts` (extend `importsOf` to follow `#` aliases and relatives), new `packages/services/test/layers.ratchet.ts`
holding the current offender lists for tests 4, 6, 8, 10, 13, 14, 15; enable tests 1, 2, 3, 9, 11, 12 immediately (they already pass).
Stays passing: whole suite. Risk: false positives from regex imports; assert on the parsed import specifier (`from '…'` and `import('…')`), not substrings.
Do not: fail on type-only imports of `@circi/db` types (`Database`) in routes; allow `import type { Database }`.

### Step 2. Errors into `core` (S)
Files: `packages/core/src/errors.ts` (add `NotFoundError`, `ConflictError`, `ForbiddenError`, `DomainError`), `packages/db/src/errors.ts` (re-export from core, keep `pgErrorCode`),
`packages/integrations/src/errors.ts` (remove `status`, keep subclasses), `apps/server/src/http/lib/errors.ts` (code table incl. integration codes), then drop the
try/catch in `integrations-generic.ts` and `settings.ts`.
Stays: `http/lib/errors` tests, integration route tests, `layers.test.ts`.
Risk: `instanceof` identity across the re-export, so keep a single class definition and re-export, never duplicate. Do not rename the error names (`err.name` is logged and asserted).

### Step 3. Constants and rules up to `core` (S, P with step 2)
Files: `core/src/{triage,review-sources}.ts` (new), `db/schema/*` imports them, `routes/dashboard/{triage,ignore-regions}.ts`, `services/src/git-events.ts` stop importing `schema`;
`http/lib/instance-settings.ts` reads the default from `core/limits.ts`; webhook-event validation from `settings.ts` to `core/webhook.ts`.
Stays: db schema test, triage/rules/webhook tests. Removes 3 of the 4 `schema` import sites in the server.

### Step 4. Access policies (M)
Files: new `packages/services/src/access/{actor,policies}.ts` + `test/access.test.ts`; rewrite `http/lib/{project-access,workspace-access}.ts` as adapters over the policies
(they keep their exported names and signatures, so no route changes yet); then replace inline `role === 'owner' || 'admin'` in the 13 files one by one.
Stays: all route tests (they exercise 401/403/404 per role: `settings.test.ts`, `rules-triage.test.ts`, `integrations.test.ts`, `workspace*.test.ts`).
Parallel (P) after the policies land: 3 agents by file groups: (a) `settings.ts`, `rules.ts`, `comments.ts`; (b) `domains.ts`, `workspaces.ts`, `workspace-settings.ts`, `workspace-auth.ts`, `workspace-sso.ts`;
(c) `integrations.ts`, `integrations-generic.ts`, `github-app.ts`, `cli/admin.ts`. Each ratchet list shrinks as its group completes.
Risk: the 404-vs-403 distinction (non-members must see 404) is the security behaviour; port the existing branch order exactly and cover it in `access.test.ts`.
Do not: pass Fastify `reply` into services; throw HTTP statuses from services.

### Step 5. Writes through services (L, P)
For each of the 25 mutating repository functions called from the server, create a use case in `services/src/<area>/` that opens the transaction (even if it only does
one write today) and returns the changed row. Group by area, each agent owns its route files, its new service files, and its service tests:

| Agent | Routes | New service files | Repository functions |
| --- | --- | --- | --- |
| A | `settings.ts`, `rules.ts`, `ignore-regions.ts` | `services/src/projects/settings.ts`, `rules/*`, `ignore-regions.ts` | `updateProjectSettings`, `setProjectAppearance`, `create/update/deleteReviewRule`, `create/deleteWebhook`, `add/removeIgnoreRegion`, `setTriageRotation` |
| B | `domains.ts`, `workspace-*.ts`, `workspaces.ts` | `services/src/workspaces/*` | `add/removeWorkspaceDomain`, `setWorkspaceSettings`, `setWorkspaceAuthSettings`, `setSetting` |
| C | `integrations*.ts`, `github-app.ts`, `issue-trackers.ts` | `services/src/integrations/*`, `settings/github-app.ts` | `createIntegration`, `deleteIntegration(Link)`, `replaceIntegrationCredentials`, `setIntegrationAttention` |
| D | `v1/*`, `argos/*`, `sites` | `services/src/builds/*`, `sites/*` | `markFileVerified`, `setParallelTotal`, `recordPublicUrl`, `createSite*` |

Stays: every route test and its service test; `contract-check.ts`; the outbox test (`outbox.test.ts`).
Each use case gets a test next to the existing ones, using `@circi/testing` PGlite.
Risk: merge conflicts in `services/src/index.ts` (80 lines of exports): give each agent its own `index` section or switch to `export * from './<area>/index.ts'` first (S, do it before spawning).
Do not: add a service that only forwards a repository call with no transaction and no rule; for those, route may call a `db/queries` read model, and a plain write may stay only if the ratchet entry says why.

### Step 6. Untangle `db` (M, P with step 5)
Files: `db/src/queries/*` (10 files) take shared helpers from `db/src/shared/`; move `repositories/{jobs,webhooks,git}.ts` to `db/src/queue/`
and add subpath exports in `packages/db/package.json` (`./queries`, `./repositories`, `./queue`, `./schema`); keep `@circi/db` root re-exporting everything for one step.
Stays: `db/test/**`, `layers.test.ts` (update the `OUTBOX` constant to the folder rule).
Risk: the barrel `index.ts` (62 lines) exports 90+ names with `export *`; a name clash shows up as a type error, not a runtime one. Do not rewrite import sites in this step; only add the subpaths.

### Step 7. Move the build pipeline and job logic into services (L)
Files: `worker/src/jobs/process-build.ts` -> `services/src/builds/process.ts` (takes `{ db, storage }`, keeps the exact algorithm and idempotency), `worker/src/lib/{files,concurrency}.ts`,
then `notify-git`, `deliver-webhook`, `integration-event`, `send-email`, `review-sweep` bodies into `services/src/{git,webhooks,integrations,notifications}/…`;
`worker/src/handlers/*` become 10-line adapters; split `runner.ts` into claim/retry and `handlers/index.ts`.
Stays: all `apps/worker/test/**` (they call `processBuild` etc. by name; keep the worker exports as thin re-exports for one step), `e2e/` (Docker stack, run manually).
Parallel (P): two agents: (a) process-build + files + concurrency; (b) the four notification/webhook/email/integration jobs. `runner.ts` split afterwards by one agent.
Risk: `@circi/diff` becomes a services dependency (add to `packages/services/package.json`); keep image work behind the `StorageDriver` and a `diff` function passed in `Deps` so tests can fake it.
Do not: change job names or payload shapes (queued rows from the old version must still run during a rolling deploy).

### Step 8. Composition root and `http/lib` clean-up (M)
Files: rename `lifecycle/` -> `composition/` (update `#lifecycle/*` alias); move `http/lib/github-app.ts`, `integration-context.ts`, `install-state.ts`, `instance-settings.ts`
to `services/src/{settings,integrations}/`; `doctor.ts` probe injected; `CIRCI_WEB_DIST` into config; `cli/admin.ts` split into `cli/commands/*` (P: one agent).
Stays: `apps/server/test/{lifecycle,cli,bundle}.test.ts`, `deploy/` Docker smoke, `pnpm build` (tsdown bundle includes the worker).
Risk: the tsdown server bundle resolves `@circi/worker` and `@circi/services` source; confirm `bundle.test.ts` still passes after folder renames.

### Step 9. Route folders and thinning (M, P)
Files: move `routes/dashboard/*.ts` into `routes/dashboard/<area>/{routes,schemas,presenters}.ts`, split `integrations-generic.ts` and `argos/index.ts`.
Mechanical; the route-table snapshot proves no URL moved. Parallel by resource group (integrations, projects/settings, workspaces, builds/reviews, instance).
Do not: combine this with step 5 in the same agent; moving and changing a file at once hides regressions.

### Step 10. Group `services` and `core` by area; enable all ratchets at zero (S)
Files: `services/src/*.ts` into `<area>/` folders, `core/src` into `rules/`, `tokens/`, `outcome/`; delete every ratchet list; turn tests 4, 5, 8, 10, 13, 14, 15 into plain
`toEqual([])`; add the lint overrides in 4.2; add the "Layers" section to `CLAUDE.md` (the one doc edit in this plan).
Stays: everything.

### 5.1 Summary

| Step | Size | Parallel | Depends on |
| --- | --- | --- | --- |
| 0 route snapshot | S | no | none |
| 1 ratchet | S | no | 0 |
| 2 errors to core | S | yes with 3 | 1 |
| 3 constants to core | S | yes with 2 | 1 |
| 4 access policies | M | 3 agents after core file | 2 |
| 5 writes through services | L | 4 agents | 4 |
| 6 untangle db, subpath exports | M | yes with 5 (disjoint: `packages/db` only) | 1 |
| 7 pipeline into services | L | 2 agents | 5 (shared `services/index.ts`), 6 |
| 8 composition root | M | CLI split in parallel | 7 |
| 9 route folders | M | per resource | 5, 8 |
| 10 group and zero ratchets | S | no | all |

### 5.2 Global risks and "do not"

- Do not move code and change behaviour in one commit; every step above is either a move (verified by unchanged tests) or an extraction with new tests.
- Do not introduce a repository interface/DI container layer. The `Database` handle passed as an argument is already the seam, and PGlite tests rely on it.
- Do not create a `domain` package separate from `core`; `core` is already the domain and has no dependents to break.
- Do not make `db/queries` go through services; the read-model shortcut is deliberate and `contract-check.ts` guards it.
- Do not let two agents edit `packages/services/src/index.ts`, `packages/db/src/index.ts`, `.oxlintrc.json` or `layers.test.ts` in parallel; give one agent each file per step.
- Rolling deploys: queued jobs and webhook rows persist across versions; never rename job kinds or payload keys in steps 7 or 8.
- Migrations: nothing here changes the schema; if a step seems to need one, stop (CLAUDE.md: better-auth tables are generated, never edited).
- Third-party edges (GitHub, SMTP, OIDC, vendors) remain tested against fakes; moving the pipeline into services does not change that, and `pnpm test:e2e`
  on the Docker stack should run once after steps 7 and 8, since the unit tests cannot see wiring errors in the composition root.

## 6. Expected end state, in numbers

- `apps/server/src/http/routes`: 0 imports of `repositories`, `schema`, `drizzle-orm` (now 91 repo functions in 42 files, 3 `schema` sites, 1 drizzle query).
- 1 implementation of "who may do this" (now 14 files).
- 1 error taxonomy and 1 `code -> status` table (now 3 homes plus 2 route-local translations).
- `apps/worker` below 400 lines in total (now 1,223), `routes/**` files all under 250 lines (now 3 above), `cli/admin.ts` split (611 -> six files under 120).
- `layers.test.ts` asserting 15 rules instead of 5, with no ratchet lists left.
