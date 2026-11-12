# Remaining work: missing features and fixes

Status: 2026-11-08. Everything is committed on `main` . The Base UI migration,
the e2e speed plan, the tsdown plan and the review-rule decisions are done (see Done); what is
left is listed below by kind.

## Done (verified against the code, 2026-11-08)

- **Migration to Base UI and CSS modules, MUI removed** (`6a8a8c3` the design system, `012190e`
  web feature folders and browser tests, `39d51f8` tooling). Also layered packages and test
  reorganisation (`7a69f94`, `9bd87e3`, `8a935e8`, `ad817af`).
- **Real-stack e2e suite** (`75dbd7f`, `e2e/`, `pnpm test:e2e`), and its **speed plan**
  (`docs/plans/archive/e2e-speed-plan.md`, steps 0 to 5: 3 workers, shared stacks, Postgres `LISTEN/NOTIFY`
  worker wake-up; 154 s instead of about 600 s).
- **tsdown plan, all 4 steps** (`6a8a8c3` ui, `c07d803` cli and vitest, `66e7186` server bundle in
  the Docker image, `a8ceacc` internal packages ship TypeScript). Only five things build: ui, cli,
  vitest, the server bundle, web. `docs/plans/archive/tsdown-plan.md`.
- **`X-Forwarded-For` / `TRUSTED_PROXIES`** (`9bd87e3` config, `8a935e8` server, `cfdbe6b`
  deploy and e2e compose). Default trusts no proxy; regression tests in
  `apps/server/test/http/routes/client-address.test.ts`.
- **SSO e2e coupling**: each workspace SSO test now takes its own tenant (`freshWorkspace` in
  `e2e/test/auth/sso.browser.e2e.test.ts`, `75dbd7f`); a single test can run with `-t`.
- **`serve.ts-E` deleted, stale `dist/` folders gone**: the only `dist/` folders are the five real
  build outputs; no `*-E` files remain.
- **Decisions of 2026-11-08, built in `4a4b138`**:
  - flaky-only merge setting (workspace setting, per-project override: `resolveFlakyBlocksMerge`,
    `onlyFlakyChanges` in `@circi/core`, `gateInputs` in `@circi/services`);
  - a webhook needs at least one event (400 in the API, `createWebhook`, `circi admin webhook add`;
    the table has had `CHECK (cardinality(events) > 0)` since `0005_webhooks`);
  - the first build is always reviewed (auto-approve needs a baseline; pinned in
    `apps/worker/test/jobs/process-build.test.ts`);
  - per-screenshot glyphs show the review (`screenshotStatus(kind, review)` in
    `apps/web/src/features/builds/diff-status.ts`; unchanged and flaky stay neutral, failed stays
    rejected).
- **Needs-review glyph**: its half fills the whole circle (`28a3ac2`).
- **S3 client timeouts**: `S3_CONNECT_TIMEOUT_SECONDS` (10) and `S3_REQUEST_TIMEOUT_SECONDS`
  (60, idle time on the socket, not total time); `circi admin doctor` reports "S3 did not answer
  in time". Tested only against a TCP server that accepts and never answers.
- **Revoked GitHub installation**: 401/404 minting the installation token, a 401 that survives
  the token refresh, or 403 "suspended" set `provider_connections.needs_attention` (migration
  0016); the notify job stops retrying, and the project and settings pages show a banner. Cleared
  by the next successful notify or by linking the repository again. The failing build's check run
  is not replayed after a reinstall. Tested against fakes only.
- **`circi admin storage gc --dry-run`**: count, bytes and sample keys of what a run would
  delete, and how many files it would newly mark; changes nothing. Does not simulate expiry of
  old builds and sites.
- **e2e github.com URL form**: `e2e/test/github-root-url.e2e.test.ts` runs a dedicated stack with
  the fake GitHub at the root; shared stacks keep the Enterprise `/api/v3` form.
- **e2e port race**: Docker assigns every host port (`127.0.0.1::N`, read back with `docker
  compose port`); TCP forwarders `edge` (circi) and `edge-s3` (LocalStack) own the published
  ports, so a restarted container keeps its address. About 4 s more per stack boot.
- **First real-stack test (2026-11-05)** and the bugs it found, each fixed with a regression test:
  `webDistPath` one folder too shallow in the Docker image, the sticky sidebar, SSO form
  autofill, the setup page title; SSRF bypass with IPv4-mapped IPv6 webhook URLs; duplicate
  GitHub check runs from concurrent notify jobs (advisory lock); a cached GitHub token kept after
  a 401; a missing bucket killing the server (and `doctor` having no storage check, `storage
  migrate` trusting same-size objects); `HEAD` on a site answering `content-length: 0`; empty
  names from email-code sign-ins; refused SSO sign-ins ending on a bare 403.
- **Dogfooding (2026-11-08)**: CirCI tests its own design system. `pnpm test:visual` (project
  `ui-visual`, registered only with `VISUAL=1`, so never in `pnpm test`) screenshots every
  `@circi/ui` component, 40 of 40, in light and dark with `@circi/vitest` in Vitest browser mode
  (103 pictures from 57 cases: the `.design-sync` previews, plus cases for Button, TextField, Dialog,
  ColorSchemeControl and the icons); without `CIRCI_*` it only saves to `.circi/screenshots`.
  `e2e/test/platform/dogfood.browser.e2e.test.ts` runs it against the real stack: first build all `added` and pending,
  approve, second run on the same commit `no_changes`. Three runs locally were byte-identical. Not
  covered: open Menu, Select and Tooltip popups (previews show them closed), hover/focus/pressed
  states, the web app's own pages, other browsers (Firefox, WebKit), CI on Linux (fonts and
  anti-aliasing differ per OS: baselines are per machine until the suite runs in one place). Found
  in `@circi/vitest`: its main entry could not be imported by a browser test (node-only reporter;
  now `@circi/vitest/browser`), `circiScreenshot` saved next to the test file where the reporter
  never looked, and the reporter looked in the cwd rather than Vitest's root; each has a test.
- **Cleanup pass (2026-11-08)**:
  - Seeders: the six hand-inserting tests now use `@circi/testing` (new `seed/auth.ts`:
    `seedAccount`, `seedInvitation`, `seedWorkspaceDomain`, `seedSsoProvider`; `seedUploadClaim`;
    existing `seedBuild` and `addTestMember`). The seeders insert better-auth rows directly (as
    `seedWorkspace` already did), not through its API.
  - `optimizeDeps.include` is pinned for `ui`, `web-browser` and `ui-visual` in `vitest.config.ts`
    (`ui` and `web-browser` run with their package as `root` so the ids resolve; `ui-visual` stays
    rooted at the repository, where its screenshots go, and reaches Base UI through `@circi/ui`,
    now a root devDependency); a cold Vite cache passes on the first run.
  - Web bundle: no chunk warning any more (the `http` chunk is 1 kB; the largest chunk is `react`
    at 219 kB, then `index` 155 kB, `tanstack` 110 kB), so the limit stays at 250 kB.
  - Empty directories `apps/web/src/pages/` and `apps/worker/test/support/` deleted.
  - `packages/ui/test` and `.design-sync/previews` are typechecked (`pnpm typecheck`; previews
    through `packages/ui/tsconfig.previews.json`); Dialog and TextField tests use
    `toHaveAccessibleDescription`. `packages/ui/visual` is not typechecked: it imports
    `@circi/vitest`, whose `@circi/cli` source fails under the DOM lib (`Uint8Array` as
    `BodyInit`).
- **Migration cleanup**: `primitives/`, `LegacyRouterLink` and the MUI theme deleted; own
  colour-scheme manager; z-index scale; import rules in `layers.test.ts`; `renderPage` is the one
  web test helper.

## 1. Bugs, safety and cleanup (open)

- Webhooks: no per-project webhook limit; a delivery-time private-address skip is only logged.
  (Fixed: "Regenerate secret" on a webhook, with a confirm and the new secret shown once.)
- Fixed: an undecodable PNG now ends the build as an error naming the screenshot(s) (the CLI
  prints it and exits 2 when the project blocks merges); it used to be one failed screenshot.
- GitHub: `installation` events now flag the connection "needs attention" (deleted, suspend) or
  clear it (created, unsuspend), and a closed or merged `pull_request` closes the open review
  requests on its builds (as dismissed). `push` stays unhandled on purpose: builds learn their
  commit from the CLI, and the App doesn't subscribe to it. `installation_repositories`
  (repositories added or removed) is still ignored. No GitHub OAuth/device flow in CirCI: GitHub
  identities were inserted by SQL in the tests, so the "link GitHub" step on the Account page is
  untested.
- Sites: fixed: an expired address (a branch address past retention, or a version's commit
  address) is remembered in `expired_site_hostnames` and answers 410 "Site expired" to people who
  may open the site; everyone else gets the same sign-in and "not found" as for an unknown
  address. Still missing: no story deep links for sites.
- Same-size migration corruption is only detected when the S3 target object has a checksum; an
  fs target is checked by size only.
- LocalStack accepts any credentials: wrong-credentials handling is covered only by a fake 403
  S3 at the edge.
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
  Previews in `.design-sync/previews/` are typechecked (`tsconfig.previews.json`); `packages/ui/visual` is not (see Done).
- `Delayed` default is 300 ms (spec; the code agrees); the old app used 1000 ms: confirm.
- Run design-sync again after any change and do the **attended upload** to the design project
  (`DesignSync`): nothing has been uploaded, and no person has reviewed the grades.

## 3. Product decisions (decided 2026-11-10)

All of the open decisions were answered by the owner on 2026-11-10:

1. **Logo and favicon:** the existing logo (`apps/web/src/features/auth/logo.svg`, the maroon
   tile) everywhere: favicon, the app frame where the word "CirCI" stands today, auth screens.
2. **Light palette:** tune it on the canvas (chrome/panel separation, accent), with the same
   contrast tests dark has; the owner approves before it is applied.
3. **Toasts:** visible toasts for every action, success and error, everywhere (saves included);
   reversible actions carry Undo in theirs. Built (Toast in `@circi/ui`, `lib/toast.ts`).
4. **Banners** (invitation, address change): inside the panel, under the sticky page header. Built (`PanelNotices`).
5. **Primary buttons:** at most one primary per area: the page header, each dialog, each pane.
6. **Forms:** label column (label and help left, control right) from about 900px wide; stacked
   below that. Saving stays per the settings save rule.
7. **Confirmations:** undo when reversible (approve, reject, dismiss, snooze...: act at once with
   an Undo toast, plus the reason prompt where the project requires one); confirm when not
   reversible and risky (remove a member, a domain or an SSO provider, delete anything).
8. **Remembered workspace:** on the server, with the user's account, so every device opens the
   workspace last used.
9. **Sortable columns:** every table gets click-to-sort headers.
10. **First-run setup:** steps (admin account, workspace, storage check, first project with its CI
    snippet), with progress and Back.
11. **Workspace switcher with one workspace:** shown, as a menu (settings, New workspace).
12. **Component sign-off:** the owner approves on the canvas; `Provisional` is a label only and
    never blocks shipping.
13. **Light-mode popup shadow:** kept (light popups only; panels and cards stay hairline).
14. **Empty states:** icons only (Lucide). Done.
15. **Status glyphs** for added/removed/flaky: own glyphs and colours. Done.
16. **After approving a screenshot:** move to the next one needing review; when none are left,
    stay and offer Approve all.
17. **Wording:** "commits", not "builds", where a count is of commits (Triage strip, flaky reason).
18. **Apps:** an installable PWA on desktop and phones, with web push sent by each server itself
    (VAPID, no central relay); a phone layout for every page; and in the PWA a **tabs** feature:
    several pages of the app open at once as tabs. Design first, owner approves, then build.
    **Approved 2026-11-10** (canvas rows "Light palette proposal" and "Apps · PWA, phone, tabs",
    version 145): the proposed light palette as is; phones get a bottom tab bar (Inbox, Reviews,
    Triage, Projects, More) and a full-bleed panel; tabs only in the installed app; the desktop tab
    strip is the window's first row with the ⌥ shortcuts (⌥T, ⌥W, ⌥1-9, ⌘⇧T, ⌘Enter on a row).
    The rest follows the boards' defaults: comment regions drawable on phones through a draw mode,
    ignore regions view-only; install banner after the second visit or first approval; push asked
    in context on Reviews, "Not now" returns after 14 days, at most 3 times; 12 tabs on desktop
    (5 pinned), 8 on phones; tabs persist per device and clear on sign-out.
    **Native apps (2026-11-10):** desktop only for now, as a Tauri 2 app
    (`docs/plans/native-apps-plan.md`); native phone apps are TBD.

## 4. Missing UI features (open)

- **Build review:** ignore-region toggle (the build API sends no region data); list thumbnails
  and the narrow-screen "All screenshots" link were dropped; per-screenshot approve (only whole
  build today; PLAN.md lists per-screenshot comments as later); what a reviewer sees after
  approving (next build or stay) is undecided; resizable list width; synced zoom/pan across
  panes (PLAN.md M4).
- **Projects:** webhook "test delivery" button and "delete project" (design describes both; the
  API has neither); "New workspace" item in the workspace switcher (no API/flow in the web app).
- **Shell:**
  - The workspace list is derived from projects and capabilities, because there is no workspace-list
    endpoint: a workspace with no projects that you can't manage does not appear. Add an endpoint
    (`@circi/api` + `db/queries` + route) and use it.
  - No CirCI version anywhere (sidebar footer, sign-in screens): expose it from the server
    (`/api/instance` or the health route).
  - Recent/pinned projects in the sidebar (alphabetical, max 10 today).
- **Sites page:** site switcher, embedded live view, PR-comment sites row, slug rename, S3
  per-file transport (PLAN.md; unbuilt).
- **Settings:** the settings breadcrumb takes the workspace name from the cached projects list because
  the settings response has no workspace name: add it to the API.
- **Auth screens:** logo (needs the SVG, §3) and version footer.
- **Members:** role change (`updateMemberRole`) is new in the UI and has never run against a real
  better-auth server. Not looked at: the row menu and validation-error screenshots; real invite
  email.
- **Keyboard shortcuts:** `a`/`r` are new in the build review; document all shortcuts in the
  README/user docs (`?` help dialog exists).

## 5. Tests still missing or to fix (open)

- `auth` `plugins/workspace-sso`: only a smoke test (`resolveUser` needs a full identity-provider round
  trip); covered by server route tests only.
- `cli`: tests run against a fake CirCI server in a non-git directory; git-ancestry paths against
  a real repo are not covered. `migrate --to s3` is tested only to the missing-bucket error (no S3
  fake).
- Browser-mode tests: Select, Menu and Tooltip positioning only checked in Chromium on
  generated cases; `Ref` copy tested against a stubbed `navigator.clipboard`.
- Dogfooding: done, see Done; the web app itself is still not screenshotted.
- Visual regression for the web app itself (CirCI testing itself) is not set up.
- **Not type-checked:** `apps/web/test` (the root tsconfig excludes `apps/web`, the web tsconfig
  covers only `src`) and `packages/ui/visual` (it imports `@circi/vitest` → `@circi/cli`, whose
  `Uint8Array` fetch bodies fail under the DOM lib; plus one error in `ui.visual.test.tsx`).
- `AccountPage.browser.test.tsx` had 2 failures in one cold-cache run ("reading 'token'") and
  passed on three reruns: possibly flaky.

## 6. Docs

Done 2026-11-08: `docs/plans/archive/refactor-plan.md` and `docs/plans/archive/base-ui-plan.md` status lines and progress,
`docs/design-gaps.md` §6 to §8 deviations, CLAUDE.md layout lines (`apps/web` `app/` and `lib/`),
PLAN.md stack line, README (browser-mode prerequisite, light/dark), `docs/reference/ci-examples.md`
(Playwright chromium for browser-mode tests; there is no CONTRIBUTING file).

Still open: the README/user docs do not list the build-review keyboard shortcuts (§4).

## 7. Product features not built yet

- GitLab / Gitea / Bitbucket adapters; GitHub App manifest flow.
- Argos real-SDK contract test.
- M4: CloudFront, Azure, SAML, quotas, Helm chart, metrics, storage usage page.
- Site switcher, embedded live view, PR-comment sites row, slug rename, S3 per-file transport.
- Linear-style workflows: designed in `docs/plans/linear-features-plan.md`, nothing built.

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
