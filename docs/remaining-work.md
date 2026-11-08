# Remaining work: missing features and fixes

Status: 2026-11-05, after the Base UI migration (shell, all pages, MUI removed). Everything here is **not done**. Source in
brackets: where it was found. Nothing in this file is committed work: the whole migration is
still uncommitted in the working tree.

## 0. Do first

1. **Commit the work.** About 350 changed files are uncommitted. Commit in logical pieces, each
   with `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green
   (CLAUDE.md). Suggested pieces: theme + light scheme; Base UI spike and `@circi/ui`; back-end
   layout moves and test moves; test seeders and new tests; web shell; pages; real-stack fixes.
2. **Real-stack test, 2026-11-05 (done once, Docker compose + Chrome):** the stack built and ran
   (postgres + circi, both healthy); first-run setup, project creation with the one-time token
   dialog, real `circi upload` of a baseline and a changed build (2 changed, 1 added, 1 removed),
   the build review (side by side, diff, swipe, `j`, `?`, `a` approve), project page, settings,
   members, light/dark switch persisting across reload, the phone layout and drawer, sign-out,
   wrong password, sign-in returning to the requested page all worked. Bugs it found and that
   are fixed (each with a regression test): the Docker image served "Web app not built"
   because the file move put `webDistPath` one folder too shallow (`lifecycle/services.ts`);
   the sidebar's account menu was off-screen on pages taller than the window (`AppFrame`
   sidebar is now sticky); the browser autofilled the user's own login into the single sign-on
   Client id/secret fields; the tab title said "Sign in" on the setup page.
   Since then the real-Docker suite `e2e/` (`pnpm test:e2e`, see `e2e/README.md`) was built and
   covers: fs and S3 (LocalStack) storage, retention and GC, `storage usage|migrate`, webhooks
   (signing, retries, SSRF guard), flaky builds, invitations and member removal, email-code
   sign-in, org SSO and instance OIDC (fake IdP), static sites incl. hostile archives, the GitHub
   App and merge gate (against a FAKE GitHub), reject/approve and the review screens. First full
   serial run: 139 of 146 passed (17 minutes); the 7 failures were test races and a missing
   error redirect, all fixed (see §0b).

3. Decided 2026-11-08 and built: after approving or rejecting a build, the per-screenshot glyphs
   show the review (`screenshotStatus(kind, review)` in
   `apps/web/src/features/builds/diff-status.ts`); unchanged and flaky stay neutral, failed stays
   rejected. Observed on the real stack, not fixed: `ref`-based
   automation can't click Base UI menu items (real clicks and the keyboard work, and the tests
   cover both).
4. The stack is left running (`cd deploy && docker compose down` stops it; add `-v` to delete
   its data). The test admin's credentials are in `deploy/.env` (gitignored).

## 0b. What the real-stack suite found (2026-11-05)

Fixed, each with a regression test in the owning package:
- SSRF guard bypass: IPv4-mapped IPv6 webhook URLs (`http://[::ffff:169.254.169.254]/`) were
  accepted (`packages/core/src/webhook-url.ts`).
- Two concurrent notify jobs created duplicate GitHub check runs and PR comments (advisory lock,
  `withAdvisoryLock` in `packages/db/src/client.ts`, used by `apps/worker/src/jobs/notify-git.ts`).
- The GitHub client kept using a cached installation token after a 401 (`packages/providers`).
- A missing bucket or unreachable S3 endpoint killed the server with a raw "UnknownError";
  `circi admin doctor` had no storage check; `storage migrate` accepted any same-size object as
  copied (now compares the checksum).
- `HEAD` on a site answered `content-length: 0` (`apps/server/src/http/sites/serve.ts`).
- Email-code sign-ins created accounts with an empty name (falls back to the part before `@`).
- A refused SSO sign-in (stranger, untrusted provider) ended on a bare 403 JSON page: the auth
  hooks now throw coded errors so better-auth redirects to the login page with `?error=`.
- Earlier: `webDistPath` after the layout move, sticky sidebar, SSO form autofill, setup title.

Not bugs but worth knowing (decide whether to change):
- ~~A pull request whose only change is a flaky screenshot still blocks the merge (flaky is a
  dashboard grouping only).~~ Decided and done (2026-11-08): it is a setting. The organization's
  **Flaky screenshots block merges** (members page, default on, so nothing changes for existing
  installs) and a per-project override (nullable: null inherits, or explicitly on/off).
  `resolveFlakyBlocksMerge` and `onlyFlakyChanges` in `@circi/core`; `gateInputs` in
  `@circi/services` feeds the status endpoint (`--wait`) and the git notice. With it off and only
  flaky screenshots changed, the gate is the success path (check run success, outcome pass); the
  build still lists them as changed/flaky. Tests: core, db, services, worker, server routes, web,
  `e2e/test/merge-gate.e2e.test.ts`.
- ~~An empty `events` list on a webhook subscribes it to every event.~~ Decided and done
  (2026-11-08): not allowed. Creating a webhook with no events is a 400 ("Choose at least one
  event for the webhook to receive") in the API, `createWebhook` and `circi admin webhook add`;
  the form shows the error and sends nothing. No data migration was needed: the table has had
  `CHECK (cardinality(events) > 0)` since `0005_webhooks`, so no row can hold an empty list
  (a test pins that). Still open: no regenerate-secret
  endpoint; no per-project webhook limit; a delivery-time private-address skip is only logged.
- A revoked GitHub installation (401) is not surfaced: the job retries 5 times and ends
  `failed` in `jobs.last_error`; there is no "needs attention" flag or banner.
- ~~No neutral state for a project with no baseline (every screenshot is "added" and held for
  review).~~ Decided (2026-11-08): keep it, and done: the first build is never
  auto-approved, not even on the default branch with auto-approve on (auto-approve needs a
  baseline). Until someone approves it, later builds have no baseline either and are held too.
  Pinned by tests in `apps/worker/test/jobs/process-build.test.ts` (a first PR or default-branch
  build ends pending review and the gate says fail; the second default-branch build, with an
  approved baseline, is auto-approved). Still open: an undecodable PNG counts as a failed screenshot, not a build error.
- No handler for GitHub `installation`, `pull_request` and `push` events (accepted and ignored);
  no GitHub OAuth/device flow in CirCI: GitHub identities were inserted by SQL in the tests, so
  the "link GitHub" step on the Account page is untested.
- ~~The per-client sign-in rate limit was keyed on the client-supplied `X-Forwarded-For`.~~ Done:
  `TRUSTED_PROXIES` (default none) decides whose forwarded header is believed; Fastify resolves
  `request.ip` and the auth route hands that to better-auth as the only `X-Forwarded-For` it sees.
  Regression tests: `apps/server/test/http/routes/client-address.test.ts`.
- The S3 client has no connect/request timeout (a silently dropped connection could hang).
- `storage gc` has no dry-run; an expired site simply disappears (no "expired" marker, an
  expired address answers like an unknown one); no story deep links for sites.
- Same-size migration corruption is only detected when the S3 target object has a checksum; an
  fs target is checked by size only.
- LocalStack accepts any credentials: wrong-credentials handling is covered only by a fake 403
  S3 at the edge.
- `e2e/test/sso.e2e.test.ts`: the org SSO tests depend on each other's state (run a single one
  with `-t` and it can fail).
- Leftover from before this work: `apps/server/src/http/sites/serve.ts-E` (an old `sed -i` backup,
  not compiled): delete it if you don't need it.

Not verified: real GitHub (rate-limit headers, 401 semantics, Enterprise), Okta/Keycloak,
Linux/CI for `pnpm test:e2e`, a cold image build, parallel runs by several people.

## 1. Migration cleanup: DONE except the items below

Done (2026-11-05, full chain green: 171 test files, 1169 tests, build, design-sync local run):
`primitives/`, `LegacyRouterLink` and the MUI theme deleted; MUI and emotion removed from every
package.json, the catalog and the lockfile; own colour-scheme manager; z-index scale; import
rules in `layers.test.ts`; stopgap build rows replaced; `auth-client` `fetch` stubbable;
`renderPage` is the one web test helper; `ListRow.onClick`, `StatusChip`, `Breadcrumbs`,
`Button` link variant and `href`, `Select.hideLabel`, icons (`GlobeIcon`, `RowMenuIcon` folded
in, only `icons.ts` imports lucide).

Left:
- Web bundle: total JS is 755 kB (was 819 kB) but the shared `http` chunk is 289 kB and Vite
  still warns (limit 250 kB): find what is in it (`@circi/ui` + Base UI + better-auth client) and
  split per page or raise the limit on purpose.
- The Button link variant exists but the four ProjectPage links (Sites, Settings, Older builds,
  Newest builds) use `href` with the secondary look: decide whether they should be link-styled.
- Projects rows no longer show "·" separators or truncate long branch names (they use the builds
  feature's `BuildMeta`): check on a real project.
- Stale `dist/` folders after file moves: `pnpm build` regenerated them; delete any that remain.
- `.vitest/attachments/failure-screenshots/` (gitignored): delete.
- Two earlier agents left stuck Vitest processes that made the full suite hang or fail 16
  browser tests; they were gone by the time everything was re-run (all green twice). If the
  browser project hangs again, look for leftover `vitest` and `chrome-headless-shell` processes.

## 2. `@circi/ui` follow-ups

- Design-sync previews missing or thin: all `*Icon` wrappers ("floor card"), `ConfirmDialog`
  (open state only), `Menu` (closed only), `Select` open popup, `Drawer`, `AppFrame` `compactBar`.
  Previews in `.design-sync/previews/` are formatted and linted but not typechecked.
- Test files in `packages/ui/test` are not covered by `packages/ui/tsconfig.json`; the spike's
  Dialog test uses the untyped `getByRole(..., { description })`.
- `Delayed` default is 300 ms (spec); the old app used 1000 ms: confirm.
- Run design-sync again after any change and do the **attended upload** to the design project
  (`DesignSync`): nothing has been uploaded, and no person has reviewed the grades.

## 3. Missing UI features (product behaviour not built yet)

From the design spec and what the new pages dropped or could not build:

- **Build review:** ignore-region toggle (the build API sends no region data); list thumbnails
  and the narrow-screen "All screenshots" link were dropped; per-screenshot approve (only whole
  build today; PLAN.md lists per-screenshot comments as later); what a reviewer sees after
  approving (next build or stay) is undecided; resizable list width (design asks, undecided);
  synced zoom/pan across panes (PLAN.md M4).
- **Status glyphs:** added, removed and flaky screenshots share the `needs-review`/`neutral`
  glyphs and differ only by label. Decide whether to extend `StatusIcon` (+, −, ~).
- **Projects:** webhook "test delivery" button and "delete project" (design describes both; the
  API has neither); "New organization" item in the org switcher (no API/flow in the web app).
- **Shell:**
  - The org list is derived from projects and capabilities, because there is no org-list
    endpoint: an org with no projects that you can't manage does not appear. Add an endpoint
    (`@circi/api` + `db/queries` + route) and use it.
  - No CirCI version anywhere (sidebar footer, sign-in screens): there is no version source in
    the web app; expose it from the server (`/api/instance` or the health route).
  - Remembered org is kept in `localStorage`: decide whether it should live in the user's
    settings on the server.
  - Recent/pinned projects in the sidebar (alphabetical, max 10 today).
- **Sites page:** site switcher, embedded live view, PR-comment sites row, slug rename, S3
  per-file transport (PLAN.md; unbuilt).
- **Settings:** the settings breadcrumb takes the org name from the cached projects list because
  the settings response has no org name: add it to the API.
- **Auth screens:** logo (needs the SVG, see §4) and version footer.
- **Members:** role change (`updateMemberRole`) is new in the UI and has never run against a real
  better-auth server; removing a member, domain or SSO provider now asks for confirmation (it
  acted immediately before): confirm this is wanted. `Select` always shows a visible label; add
   Not looked at: the row menu and validation-error
  screenshots; real invite email.
- **Keyboard shortcuts:** `a`/`r` are new in the build review; document all shortcuts in the
  README/user docs; `?` help dialog exists.

## 4. Design decisions still open (`docs/design-gaps.md` "Needs a decision")

Provisional specs were built; each of these needs a person:

1. Buttons: more than one `primary` per screen? `Kbd` hints on buttons?
2. Forms: stacked labels everywhere or a label column on wide settings pages; save per section
   or per page; instant-apply switches.
3. No toasts, really? Invitation/address-change banners: in the panel or above the frame?
4. Light-mode popup shadow: allowed despite "hairlines, not shadows"?
5. Illustrations or icons only in empty states.
6. Sidebar: recent vs alphabetical vs pinned projects; org switcher with one org; the mobile
   drawer.
7. Build review: list width, per-screenshot approve, after-approve behaviour.
8. Status glyphs for added/removed/flaky.
9. Sortable columns for large member lists.
10. Setup wizard: one page or steps.
11. **The light palette itself** (derived, not designed): chrome vs panel contrast (`#f3efed` vs
    `#fcfbfa`), accent clay `#b4573f`.
12. **Logo and favicon** as SVG per scheme (maroon `#724039` disappears on the dark chrome),
    plus the 32 px mark. The frame shows the word "CirCI" until then.
13. Who signs off components, and whether a `Provisional` mark blocks a page from shipping.
14. Reject now asks for confirmation (button and `r`): is that wanted? "Sign out everywhere
    else" now also confirms.

## 5. Tests still missing or to fix

- Several tests insert rows by hand and should use the new seeders in `@circi/testing`:
  `apps/server/test/http/routes/dashboard/sites.test.ts`, `.../github-webhook.test.ts`,
  `.../org-sso.test.ts`, `packages/auth/test/hooks/*`, `packages/auth/test/sso/trusted-issuers`,
  `packages/services/test/retention.test.ts`.
- `auth` `plugins/org-sso`: only a smoke test (`resolveUser` needs a full identity-provider round
  trip); covered by server route tests only.
- `cli`: tests run against a fake CirCI server in a non-git directory; git-ancestry paths against
  a real repo are not covered. `migrate --to s3` is tested only to the missing-bucket error (no S3
  fake).
- Browser-mode tests: Select, Menu and Tooltip positioning only checked in Chromium on
  generated cases; `Ref` copy tested against a stubbed `navigator.clipboard`; the first browser
  run after a new dependency is optimised can fail with import errors (rerun is clean): pin
  `optimizeDeps` includes in the Vitest browser config.
- Dialog opened over a MUI modal: untested (moot after MUI removal).
- Dogfooding: screenshot each `@circi/ui` preview in both schemes with `@circi/vitest` and upload
  to a local CirCI (refactor-plan §3.3). Not started; also the first real check of Vitest browser
  mode with that reporter.
- CI: add the Playwright chromium install (`playwright install chromium`) to the CI examples and
  CONTRIBUTING docs: browser-mode tests need it.
- Visual regression for the web app itself (CirCI testing itself) is not set up.

## 6. Docs to update

- `docs/refactor-plan.md`: §2.3 (`root-route.ts` separate from `router.tsx`; `ErrorState` and
  `RelativeTime` in `lib/`), §2.2 / §3.1 / §3.2 mark done items, §4.2 progress.
- `docs/design-gaps.md`: §6 deviations of the shell (org list derivation, no "New organization",
  no version, project name is the Builds entry); §7 and §8 what the builds page built and
  dropped.
- `docs/base-ui-plan.md`: step 5 and 6 status when done.
- `CLAUDE.md` layout lines: add `apps/web` `app/` and `lib/`; keep Tests section in line.
- `PLAN.md` stack line (§6: "MUI 9 (components, light/dark theme)") → Base UI + CSS modules +
  Lucide, light/dark.
- `README.md`: browser-mode test prerequisite, light/dark.

## 7. Product features not built yet (from before this refactor)

- GitLab / Gitea / Bitbucket adapters; GitHub App manifest flow.
- Argos real-SDK contract test.
- M4: CloudFront, Azure, SAML, quotas, Helm chart, metrics, storage usage page.
- Site switcher, embedded live view, PR-comment sites row, slug rename, S3 per-file transport.

## 8. Never verified against the real thing

- Real Argos SDKs, real GitHub, OIDC, SMTP, S3; Caddy image and certificates; the docker compose
  stack (Docker was intermittently down); Vitest browser mode in CI.
- The new UI against the **real server** (every screenshot so far used a throwaway fake API);
  swipe view and the light scheme in the real app; large lists; slow networks.
- Flows verified in Chrome before the migration (setup, project, build, approve, settings,
  members, account, site sign-in handoff) must be re-run on the new UI.
