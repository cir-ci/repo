# Remaining work: missing features and fixes

Status: 2026-11-08. Everything is committed on `main` (HEAD `a9b830a`). The Base UI migration,
the e2e speed plan, the tsdown plan and the review-rule decisions are done (see Done); what is
left is listed below by kind. Five fixes are **in progress** in parallel and not described here
beyond their names: S3 client timeouts, revoked GitHub installation detection, `storage gc
--dry-run`, e2e coverage of github.com URLs, and the e2e harness port race.

## Done (verified against the code, 2026-11-08)

- **Migration to Base UI and CSS modules, MUI removed** (`6a8a8c3` the design system, `012190e`
  web feature folders and browser tests, `39d51f8` tooling). Also layered packages and test
  reorganisation (`7a69f94`, `9bd87e3`, `8a935e8`, `ad817af`).
- **Real-stack e2e suite** (`75dbd7f`, `e2e/`, `pnpm test:e2e`), and its **speed plan**
  (`docs/e2e-speed-plan.md`, steps 0 to 5: 3 workers, shared stacks, Postgres `LISTEN/NOTIFY`
  worker wake-up; 154 s instead of about 600 s).
- **tsdown plan, all 4 steps** (`6a8a8c3` ui, `c07d803` cli and vitest, `66e7186` server bundle in
  the Docker image, `a8ceacc` internal packages ship TypeScript). Only five things build: ui, cli,
  vitest, the server bundle, web. `docs/tsdown-plan.md`.
- **`X-Forwarded-For` / `TRUSTED_PROXIES`** (`9bd87e3` config, `8a935e8` server, `cfdbe6b`
  deploy and e2e compose). Default trusts no proxy; regression tests in
  `apps/server/test/http/routes/client-address.test.ts`.
- **SSO e2e coupling**: each org SSO test now takes its own tenant (`freshOrg` in
  `e2e/test/sso.e2e.test.ts`, `75dbd7f`); a single test can run with `-t`.
- **`serve.ts-E` deleted, stale `dist/` folders gone**: the only `dist/` folders are the five real
  build outputs; no `*-E` files remain.
- **Decisions of 2026-11-08, built in `4a4b138`**:
  - flaky-only merge setting (organization setting, per-project override: `resolveFlakyBlocksMerge`,
    `onlyFlakyChanges` in `@circi/core`, `gateInputs` in `@circi/services`);
  - a webhook needs at least one event (400 in the API, `createWebhook`, `circi admin webhook add`;
    the table has had `CHECK (cardinality(events) > 0)` since `0005_webhooks`);
  - the first build is always reviewed (auto-approve needs a baseline; pinned in
    `apps/worker/test/jobs/process-build.test.ts`);
  - per-screenshot glyphs show the review (`screenshotStatus(kind, review)` in
    `apps/web/src/features/builds/diff-status.ts`; unchanged and flaky stay neutral, failed stays
    rejected).
- **Needs-review glyph**: its half fills the whole circle (`28a3ac2`).
- **First real-stack test (2026-11-05)** and the bugs it found, each fixed with a regression test:
  `webDistPath` one folder too shallow in the Docker image, the sticky sidebar, SSO form
  autofill, the setup page title; SSRF bypass with IPv4-mapped IPv6 webhook URLs; duplicate
  GitHub check runs from concurrent notify jobs (advisory lock); a cached GitHub token kept after
  a 401; a missing bucket killing the server (and `doctor` having no storage check, `storage
  migrate` trusting same-size objects); `HEAD` on a site answering `content-length: 0`; empty
  names from email-code sign-ins; refused SSO sign-ins ending on a bare 403.
- **Migration cleanup**: `primitives/`, `LegacyRouterLink` and the MUI theme deleted; own
  colour-scheme manager; z-index scale; import rules in `layers.test.ts`; `renderPage` is the one
  web test helper.

## 1. Bugs, safety and cleanup (open)

- Webhooks: no regenerate-secret endpoint; no per-project webhook limit; a delivery-time
  private-address skip is only logged.
- An undecodable PNG counts as a failed screenshot, not a build error.
- No handler for GitHub `installation`, `pull_request` and `push` events (accepted and ignored);
  no GitHub OAuth/device flow in CirCI: GitHub identities were inserted by SQL in the tests, so
  the "link GitHub" step on the Account page is untested. (Revoked-installation detection is in
  progress.)
- Sites: an expired site simply disappears (no "expired" marker, an expired address answers like
  an unknown one); no story deep links for sites. (`storage gc --dry-run` and S3 client timeouts
  are in progress.)
- Same-size migration corruption is only detected when the S3 target object has a checksum; an
  fs target is checked by size only.
- LocalStack accepts any credentials: wrong-credentials handling is covered only by a fake 403
  S3 at the edge.
- Web bundle: the shared `http` chunk is large (289 kB when last measured) and Vite warns (limit
  250 kB, `apps/web/vite.config.ts`): find what is in it (`@circi/ui` + Base UI + better-auth
  client) and split per page or raise the limit on purpose.
- `apps/web/src/pages/` is an empty leftover directory: delete it.
- `.vitest/attachments/failure-screenshots/` (gitignored): delete if present.
- If the Vitest browser project hangs, look for leftover `vitest` and `chrome-headless-shell`
  processes (two earlier agents left stuck ones that made the suite hang once).
- Observed on the real stack, not fixed: `ref`-based browser automation can't click Base UI menu
  items (real clicks and the keyboard work, and the tests cover both).
- The Button link variant exists, but the four ProjectPage links (Sites, Settings, Older builds,
  Newest builds) use `href` with the secondary look: decide whether they should be link-styled.
- Projects rows no longer show "·" separators or truncate long branch names (they use the builds
  feature's `BuildMeta`): check on a real project.

## 2. `@circi/ui` follow-ups (open)

- Design-sync previews missing or thin: all `*Icon` wrappers ("floor card"), `ConfirmDialog`
  (open state only), `Menu` (closed only), `Select` open popup, `Drawer`, `AppFrame` `compactBar`.
  Previews in `.design-sync/previews/` are formatted and linted but not typechecked.
- Test files in `packages/ui/test` are not covered by `packages/ui/tsconfig.json`; the spike's
  Dialog test uses the untyped `getByRole(..., { description })`.
- `Delayed` default is 300 ms (spec; the code agrees); the old app used 1000 ms: confirm.
- Run design-sync again after any change and do the **attended upload** to the design project
  (`DesignSync`): nothing has been uploaded, and no person has reviewed the grades.

## 3. Product decisions still open

Provisional specs were built; each of these needs a person (`docs/design-gaps.md`, "Needs a
decision"):

1. Buttons: more than one `primary` per screen? `Kbd` hints on buttons?
2. Forms: stacked labels everywhere or a label column on wide settings pages; save per section
   or per page; instant-apply switches.
3. No toasts, really? Invitation/address-change banners: in the panel or above the frame?
4. Light-mode popup shadow: allowed despite "hairlines, not shadows"?
5. Illustrations or icons only in empty states.
6. Sidebar: recent vs alphabetical vs pinned projects; org switcher with one org; the mobile
   drawer.
7. Build review: list width, per-screenshot approve, after-approve behaviour.
8. Status glyphs for added/removed/flaky (they share `needs-review`/`neutral` and differ only by
   label; would mean extending `StatusIcon` with +, −, ~).
9. Sortable columns for large member lists.
10. Setup wizard: one page or steps.
11. **The light palette itself** (derived, not designed): chrome vs panel contrast (`#f3efed` vs
    `#fcfbfa`), accent clay `#b4573f`.
12. **Logo and favicon** as SVG per scheme (maroon `#724039` disappears on the dark chrome),
    plus the 32 px mark. The frame shows the word "CirCI" until then.
13. Who signs off components, and whether a `Provisional` mark blocks a page from shipping.
14. Reject now asks for confirmation (button and `r`): is that wanted? "Sign out everywhere
    else" now also confirms. Removing a member, domain or SSO provider asks for confirmation
    too (it acted immediately before): confirm this is wanted.
15. Remembered org is kept in `localStorage`: should it live in the user's settings on the server?

## 4. Missing UI features (open)

- **Build review:** ignore-region toggle (the build API sends no region data); list thumbnails
  and the narrow-screen "All screenshots" link were dropped; per-screenshot approve (only whole
  build today; PLAN.md lists per-screenshot comments as later); what a reviewer sees after
  approving (next build or stay) is undecided; resizable list width; synced zoom/pan across
  panes (PLAN.md M4).
- **Projects:** webhook "test delivery" button and "delete project" (design describes both; the
  API has neither); "New organization" item in the org switcher (no API/flow in the web app).
- **Shell:**
  - The org list is derived from projects and capabilities, because there is no org-list
    endpoint: an org with no projects that you can't manage does not appear. Add an endpoint
    (`@circi/api` + `db/queries` + route) and use it.
  - No CirCI version anywhere (sidebar footer, sign-in screens): expose it from the server
    (`/api/instance` or the health route).
  - Recent/pinned projects in the sidebar (alphabetical, max 10 today).
- **Sites page:** site switcher, embedded live view, PR-comment sites row, slug rename, S3
  per-file transport (PLAN.md; unbuilt).
- **Settings:** the settings breadcrumb takes the org name from the cached projects list because
  the settings response has no org name: add it to the API.
- **Auth screens:** logo (needs the SVG, §3) and version footer.
- **Members:** role change (`updateMemberRole`) is new in the UI and has never run against a real
  better-auth server. Not looked at: the row menu and validation-error screenshots; real invite
  email.
- **Keyboard shortcuts:** `a`/`r` are new in the build review; document all shortcuts in the
  README/user docs (`?` help dialog exists).

## 5. Tests still missing or to fix (open)

- Several tests insert rows by hand and should use the seeders in `@circi/testing` (still true
  on 2026-11-08): `apps/server/test/http/routes/dashboard/sites.test.ts`, `.../github-webhook.test.ts`,
  `.../dashboard/org-sso.test.ts`, `packages/auth/test/hooks/user-create.test.ts`,
  `packages/auth/test/sso/trusted-issuers.test.ts`, `packages/services/test/retention.test.ts`.
- `auth` `plugins/org-sso`: only a smoke test (`resolveUser` needs a full identity-provider round
  trip); covered by server route tests only.
- `cli`: tests run against a fake CirCI server in a non-git directory; git-ancestry paths against
  a real repo are not covered. `migrate --to s3` is tested only to the missing-bucket error (no S3
  fake).
- Browser-mode tests: Select, Menu and Tooltip positioning only checked in Chromium on
  generated cases; `Ref` copy tested against a stubbed `navigator.clipboard`; the first browser
  run after a new dependency is optimised can fail with import errors (rerun is clean): pin
  `optimizeDeps` includes in the Vitest browser config (none set today).
- Dogfooding: screenshot each `@circi/ui` preview in both schemes with `@circi/vitest` and upload
  to a local CirCI (refactor-plan §3.3). Not started; also the first real check of Vitest browser
  mode with that reporter.
- Visual regression for the web app itself (CirCI testing itself) is not set up.
- (In progress, not described here: e2e github.com URL coverage and the harness port race.)

## 6. Docs

Done 2026-11-08: `docs/refactor-plan.md` and `docs/base-ui-plan.md` status lines and progress,
`docs/design-gaps.md` §6 to §8 deviations, CLAUDE.md layout lines (`apps/web` `app/` and `lib/`),
PLAN.md stack line, README (browser-mode prerequisite, light/dark), `docs/ci-examples.md`
(Playwright chromium for browser-mode tests; there is no CONTRIBUTING file).

Still open: the README/user docs do not list the build-review keyboard shortcuts (§4).

## 7. Product features not built yet

- GitLab / Gitea / Bitbucket adapters; GitHub App manifest flow.
- Argos real-SDK contract test.
- M4: CloudFront, Azure, SAML, quotas, Helm chart, metrics, storage usage page.
- Site switcher, embedded live view, PR-comment sites row, slug rename, S3 per-file transport.
- Linear-style workflows: designed in `docs/linear-features-plan.md`, nothing built.

## 8. Never verified against the real thing

- Real GitHub (rate-limit headers, 401 semantics, Enterprise), Okta/Keycloak, real Argos SDKs,
  real SMTP and AWS S3 (the e2e stack uses a FAKE GitHub, a fake OIDC provider, Mailpit and
  LocalStack); Caddy image and certificates.
- Linux/CI for `pnpm test:e2e`, a cold image build, parallel runs by several people; Vitest
  browser mode in CI.
- The new UI on real data at scale: large lists, slow networks; the light scheme and swipe view
  were seen only in the 2026-11-05 manual pass.
- The stack from that pass may still be running (`cd deploy && docker compose down`, add `-v` to
  delete its data); the test admin's credentials are in `deploy/.env` (gitignored).
