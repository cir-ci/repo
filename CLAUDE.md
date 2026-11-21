# CirCI: working conventions

Self-hosted visual regression testing (README.md points to the documentation site, circi.dev; docs/ has the references).

## Commands

pnpm 12, which installs and runs Node 26 itself (package.json `devEngines.runtime`). Before committing: `pnpm format`, then `pnpm gate` (Turborepo: format check, lint, typecheck, test and
build in parallel where independent, each cached by its inputs; a second run on an unchanged tree is instant). The old chain
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` still works. `pnpm build` is `turbo run build`: per-package
caching of `dist/**`, with a `transit` task so a package's build is invalidated by changes in the packages it depends on, but
not by unrelated ones. Lint and typecheck are single root commands cached as root tasks (`//#lint`, `//#typecheck` in `turbo.json`); the tests are
one root task per Vitest project, each cached on its own inputs: `//#test:node` (the Node project: logic tests of every app and
package, which read most of the tree, so it reruns on almost any change), `//#test:ui` (packages/ui only) and
`//#test:web-browser` (apps/web, ui, api, core); the two browser tasks each take a quarter of the cores (`--maxWorkers=25%`), so together with the Node tests they don't overload the machine and flake; each browser test gets one retry, for the runner's own lost-frame errors (`Frame was detached`), and a retried test still shows in the report. `pnpm test` still runs every project in one Vitest process. `@circi/testing` has no database
code (the PGlite test database and seeders are `@circi/db/testing`, part of `db`), so no package pair forms a cycle and the root's
dependency on `testing` does not reach `db` or `core`: a change in `db` reruns the Node tests, lint, typecheck, format check and the
server build, and leaves the UI/web tests and the cli, vitest, ui and web builds cached (a change in `core` also reruns what reads
`core`: the web browser tests and the web build).
`pnpm gate:checks` (format check, lint, typecheck) and `pnpm gate:tests` (the three test tasks and the build) are its two halves; CI runs them
one after the other, because together they ran its 8 GiB machine out of memory.
`pnpm gate:full` is `gate` plus the two end-to-end groups as cached root tasks, `//#e2e:api` (the server, worker and CLI image,
no browser) and `//#e2e:browser` (also the dashboard and the design system); both need Docker and Chromium, so the default
`pnpm gate` stays Docker-free. Both tasks also hash `E2E_ENV_FINGERPRINT` (Playwright, Chromium and Docker server versions, printed by
`pnpm e2e:fingerprint`; `pnpm gate:full` sets it), so a new Chromium or Docker reruns them; run `turbo run //#e2e:api` directly and the
variable is empty. They share one `docker build` of `circi:e2e` through a lock (`e2e/src/stack/build-lock.ts`). End-to-end files are named `*.browser.e2e.test.ts` when they drive Chromium (checked by
`e2e/test/fakes/e2e-groups.test.ts`); `pnpm test:e2e` runs both groups, `test:e2e:api` / `test:e2e:browser` one. Visual runs are never
cached.
The deploys: `pnpm test:compose` brings up `deploy/docker-compose.yml` (Docker); `pnpm test:terraform` runs `deploy/terraform`'s
`terraform test` (a mocked Docker provider; the CI job `terraform`). Both are held to `@circi/config`'s lists of settings
(`packages/config/src/settings.ts`: the secrets, what the image sets, what goes together) by `packages/config/test/deploy-settings.test.ts`.
What emits what: `tsc` only type-checks (`pnpm typecheck`, `noEmit`). `pnpm build` runs tsdown for
`@circi/ui` (`dist`, browser), `@circi/cli` and `@circi/vitest` (published to npm, `dist`; the only non-private packages, versioned with Changesets: a change to either needs a changeset, which the husky post-commit hook (`scripts/auto-changeset.mjs`) writes from the commit message when none is added (patch, or `[minor]`/`[major]` in the message), checked in CI, released by `.github/workflows/release.yml`; the app is versioned the same way as `@circi/server`, whose release publishes `ghcr.io/cir-ci/circi:<version>`, the version `deploy/terraform` runs, see `deploy/README.md`) and `apps/server`
(one bundle for the image), then Vite for `apps/web`. The other packages have no build: their
`exports` point at `src/*.ts`, which Node, Vitest, Vite, tsc and tsdown all read directly.
`pnpm dev` is the local QA environment (`dev/`): Postgres and Mailpit in Docker (project `circi-dev`), `circi all` from
source under `node --watch`, Vite for the dashboard on :5173 (PUBLIC_URL; it proxies every server path to :3000), and a
first-run seed (owner@example.com / member@example.com, password `circi-dev-password`, workspace `acme`, project `web-app`,
four builds in different review states); `pnpm dev:reset` deletes its data. A tiny webhook receiver (`dev/src/webhook-receiver.ts`, :4747, `CIRCI_DEV_HOOKS_PORT`) answers 204 to the seeded webhooks (one, `/fail/always`, gets 500 on purpose so the dashboard shows failures and retries; a fresh seed only) and logs each delivery as `[hooks]` with its event, delivery ID and signature check (only for webhooks the seed created; others log "not checked"), refusing bodies over 1 MiB.
Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line. No remote repo yet: commits stay local.

## Layers

```
transport    apps/server (http/, cli/), apps/worker (handlers/, jobs/), apps/web (the dashboard)
   v         parse the request, check who is asking, call a service or a read model, shape the reply
services     packages/services/src/<area>/   use cases: open the transaction, call repositories, queue
   v         the jobs and notices that follow (a transactional outbox); the worker's job bodies live here too
core         packages/core                   rules with no I/O, by area (baselines/, builds/, reviews/, integrations/, project/); `@circi/core` is
             browser-safe, `@circi/core/node` (src/node/) holds the Node-only secrets, tokens and signing
db           packages/db   queries/ (read models for the dashboard), repositories/ (stores and lookups),
             queue/ (jobs, webhook rows, git notices), schema/ (Drizzle), shared/ (helpers they share)
adapters     packages/{integrations,storage,diff,sites}   talk to GitHub, Slack, S3, images
```

Folder map: `apps/server/src/{http,cli,composition}` (`composition/` wires config, db, storage and
the worker; `http/routes/<area>/` holds routes, schemas and presenters; `http/routes/internal.ts` answers the reverse proxy only, e.g. Caddy's `/internal/tls-ask` for sites' custom domains, never browsers); `apps/worker/src` (claim
loop and thin job adapters, no build: the server bundle inlines it); `apps/web/src/{app,lib,features/<feature>}`;
`packages/api` (the wire types, types only); `packages/auth` (better-auth composition);
`packages/cli` (`circi upload`); `packages/config` (environment parsing); `packages/testing`
(db-free test support: clock, hashes, fake hosts; the PGlite test database and seeders are `@circi/db/testing`); `packages/ui` (design system: Base UI parts, CSS modules,
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
- `core` imports no `@circi` package and no I/O; `storage`, `sites`, `diff` and
  `config` import at most `core`; `db` imports none of services, integrations, storage,
  auth, api; `auth` imports no service or app; `integrations` (the SDK, the clients and the
  definitions, one folder per kind under `src/kinds/`) import at most `core` and `api`, never db,
  services or fastify, and their errors carry no HTTP status; apps and services take clients only
  from the explicit subpaths (`@circi/integrations/{git,github,gitlab,bitbucket}`); the web app imports no server package.
- **Better-auth's tables** (`schema/auth.ts`) are generated (`pnpm db:auth-schema`, then
  `pnpm db:generate`), never edited by hand. Writes to them go through better-auth's API.
- **Live updates** (the dashboard changes in place, no polling): a service that changes something the dashboard shows calls
  `emitBuildLive` / `emitProjectLive` / `emitUserLive` (`services/src/live`) in its transaction, a `pg_notify` on `circi_live`
  that is delivered on commit and dropped on rollback, carrying IDs only (`LiveNotice` in `@circi/core`). Every server instance
  LISTENs (`createLiveHub`), `GET /api/live` turns each notice into a `Live.Event` for the people who may see it
  (`canSeeProject`), and the web app's `lib/live.ts` maps events to the query keys to invalidate (`lib/live-keys.ts`). A new kind
  of change adds a `LiveNoticeType` (core), a wire type (api) and a case in `live-keys.ts`.
- **Fastify scopes** receive exactly their dependencies. Register a scope with a prefix through a
  wrapper plugin (see `app.ts`) so the plugin's options never carry `prefix`.

Where does new code go? A new endpoint: the route in `apps/server/src/http/routes/<area>/`, the
use case in `packages/services/src/<area>/` (export it from that folder's `index.ts`; the package
`index.ts` is one `export *` line per area), the read model in `packages/db/src/queries/`, the
store in `packages/db/src/repositories/`, the wire type in `packages/api`. A new background job: a
body in `services/src/jobs/` or the area folder, a thin adapter in `apps/worker/src/handlers/`,
never a new job name or payload key without a rolling-deploy plan (queued rows outlive a deploy).
A pure rule: `packages/core`. Services tests mirror the folders under `packages/services/test/`.
The layer rules are enforced by `packages/services/test/layers.test.ts`.

## Types: namespaces for the types that belong to something

Type-only namespaces (erasable, so they work with `erasableSyntaxOnly` and Node's type stripping):

- A function's input/result types are merged into it: `createBuild.Input`, `finalizeBuild.Result`,
  `planUploads.File`. Use `import type { createBuild }` when only the types are needed.
- A component's props: `export namespace Row { export interface Props { … } }` next to `Row`.
- The API's wire types, one namespace per resource: `Build.Detail`, `Project.Settings`, `Workspace.Domain`
  (`@circi/api`). Dates are ISO strings there.

A namespace must contain only types. Never put a value in one.

## Style

- **Imports:** each package's `package.json` `imports` maps a `#<folder>/*` alias per main folder
  (`#lib/*`, `#features/*`, …). Use it instead of `../../..` climbs; relative `./` stays for
  siblings.
- **CSS modules:** `styles.root`, not `styles['root']` (brackets only for names that aren't
  identifiers).
- **CSS lives in `.css` files, never in strings:** CSS modules in the web app and `@circi/ui`; a
  plain `.css` file for anything the server renders on its own (the sites 404, server notices),
  inlined at runtime if the page must load nothing. Colours and sizes come from the design tokens
  (`@circi/ui`'s theme, the `--circi-…` variables), never copied hex values.
- **Base UI wrappers:** a component that passes props on to a Base UI part extends
  `<Part>.Props` and forwards them; it never redefines them. With extra props of its own it still
  extends the Base UI props and destructures `{ own, props, ...rest }`.
- **Types:** types with a shared prefix or suffix live in one namespace (`GitProvider.StatusInput`),
  not as separate top-level names.
- **State:** state that changes or is needed across large areas, or is complex, goes in a global
  store (zustand), not scattered `useState`/context. Local, simple UI state stays in `useState`.
  The query cache is kept in IndexedDB between visits (`apps/web/src/lib/persist-policy.ts`: an allowlist of query keys, so a new
  query is stored only once it is named there; dropped on sign-out, a 401, a new build and another user).
- **One primary button per area:** at most one `variant="primary"` in the page (header and body), in each
  dialog and in each pane; the other actions are secondary, danger or ghost. A page test of a main
  page calls `expectOnePrimaryPerArea()` (`apps/web/test/support/primary-buttons.ts`).
- **Copy:** contractions ("Couldn't", "can't") with the straight apostrophe everywhere (dashboard, server,
  emails), never the curly one; US spelling ("color", "behavior", "organization", "canceled"); "project" and
  "workspace" lowercase in running text (capital only at a sentence's start or in a UI label); "ID", not "id"; "Delete" for something gone for good
  (comments, rules, projects, workspaces), "Remove" for taking it out of a list (members, webhooks,
  ignore regions, links: no "Unlink"; "Revoke" only for invitations); "screenshot", never "snapshot", in UI text. No text that states the
  obvious ("saved with Save changes", "Only owners can do this" beside a hidden control), no
  explanatory lead under a page title unless it warns about a consequence, and no helper line that
  repeats a value already shown beside it. Counts carry their noun and amounts their unit. An
  empty state never repeats a button the page already shows (an empty Integrations page has one
  Add integration, in its header).
- **Toasts and Undo:** every action says what happened in a toast, success or failure, saves included
  (`toast('Approved 3 screenshots')`, `toast.failed('save', error)` from `#lib/toast.ts`; the state is
  `lib/stores/toast-store.ts`, drawn by `ToastViewport` in `@circi/ui`). A toast is the live region: never
  also `announce` the same message (the announcer is for loading and selection). A failed `useMutation`
  toasts by itself from `meta: { what: 'save' }` ("Couldn't save: reason"); a form keeps its own field
  errors too. An action that can be taken back acts at once and its toast carries Undo (`withUndo` in
  `#lib/undo.ts`: the server's undo token, or the exact inverse call); only what can't be taken back and
  is risky (remove a member, a domain or a provider; delete anything) asks first in a `ConfirmDialog`.
  A reason dialog (rejecting) is an input, not a confirmation.
- **Settings is a closed area:** no link or redirect moves someone between settings and the rest
  of the dashboard. A settings page that needs another page (a project's Sites, a baseline's ignore
  regions) shows it inside settings, in its tab and frame; an app page never links into a settings
  page. The only ways in and out are the settings entry points (the workspace and account menus,
  ⌘K, the project page's Settings button, the Inbox's reconnect notice, and right-click context menus, e.g. a project's "Project
  settings") and settings' own way back to the app. A context menu shows its settings item only to
  those who can open those settings; the file is a named entry point in
  `apps/web/test/app/closed-settings.test.ts`.
- **Saving settings:** a change that doesn't affect anyone's workflow saves as soon as it is made,
  with no Save button: a display name, a project's colour or icon, a workspace picture, the theme,
  personal notification preferences. A change that does (merge gate, thresholds, retention, review
  rules and targets, sign-in methods, members and roles, tokens, webhooks, and slugs, which break
  links) waits for an explicit Save (or a confirmation), with Discard to revert. Don't mix the two in
  one form: an instant-save control never sits under a Save/Discard footer it isn't part of. Use a
  `Switch` for an instant setting and a `Checkbox` for one that waits for Save. A one-off action
  confirmed in its own dialog (add, edit or delete a review rule, change a role, add or remove a
  webhook, rotate a token) applies when confirmed: Save/Discard is for page-level settings forms.

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
  `pnpm test:e2e` (or `pnpm gate:full`), never in `pnpm test`; GitHub, the OIDC provider and webhook receivers are host
  fakes. A bug only the real stack finds gets a regression test in its owning package. See
  `e2e/README.md`.
- External services (GitHub, SMTP, OIDC) are faked at their edge; say so when something has only been
  tested against a fake.
