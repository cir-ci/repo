# Next steps: from the design canvas to shipped features

Status: 2026-11-08. Nothing here is built. This plan turns the CirCI Design System canvas
(https://claude.ai/artifact/WiAjMhRumRaiSMaYTeNc39, 58 boards on Foundations, Components and
Screens) and the Linear-style feature plan (`docs/linear-features-plan.md`) into work, in four
phases: **A** `@circi/ui` and `theme.ts`, **B** backend and data model, **C** web screens,
**D** integrations. Each phase opens with one spike that sets the pattern and is reviewed before
the rest fans out to parallel Sonnet agents.

The canvas is the source of truth for the UI. Its shared stylesheet (asset
`71ce7a54388668a0633e54658cccc28c` on the canvas) holds the exact token values used below.

## 1. Decisions

Settled in the design session (see the Foundations board's Decisions section) plus the answers
given while planning:

| Topic | Decision |
|---|---|
| Ship order | Review loop first: build author, review requests, notifications → Reviews and Inbox; then ⌘K, views, peek, bulk; then Triage, comments, Baselines; Insights last |
| Light mode | Ships with dark. Every phase gates on both schemes (theme tests and visual baselines for each) |
| Real integrations | GitHub (exists), GitLab, Bitbucket, Slack, Linear, Jira, Figma. **Azure DevOps, Microsoft Teams and Penpot stay "Planned"** tiles with no backend |
| Build author | The CLI sends it at upload (`GITHUB_ACTOR`, the CI's own variable, or `--author`); a connected git host's PR author replaces it; matched to a member through their linked sign-in account |
| Email | In-app by default. Email only for "review requested" and "overdue", only when SMTP is configured, and each user can turn it off |
| After approving from Inbox or Reviews | Move to the next item |
| Figma comments | Posted through the organisation's connection, naming the reviewer in the text. Per-user Figma sign-in later |
| Design difference | Never fails the check |
| Frame as first baseline | No approval of its own; linking is enough; the first approved build replaces it |
| Triage rotation | Per project |

Colour, type, radii, row heights, status glyphs, keys, words, navigation and integration groups
are as on the canvas and are not repeated here.

## 2. What the check found

The canvas, the review doc, `docs/linear-features-plan.md` and the code were compared. The
handover was right on the board count, the pages, the palette values and the committed half-fill
path. These points differ from it or need noting:

1. **The review doc's Decision column is not empty.** C1, C2, C3, C4, N1 and KB1 already say
   "Fix"; the other 35 are blank. Filling them in (all "Fix", per the decisions) is a change to the
   doc, so it waits for your go-ahead.
2. **Focus ring on rows is inset, not outside.** Foundations: "2px ring in accent.text, 2px out;
   inset 5px on rows so it differs from the 2px selected bar." The code uses `accent.main`, 2px
   out globally and `-2px` on `ListRow`.
3. **Flaky is amber on the canvas, neutral in code.** The Status board maps a flaky snapshot to
   needs-review (amber ~). `screenshotStatus` in `apps/web/src/features/builds/diff-status.ts` and
   `design-gaps.md` §8 map it to neutral. This plan follows the canvas.
4. **Project colours borrow state colours.** Foundations says chart ink is neutral, and Insights
   uses teal and crimson only for better/worse. But the project tiles (Figma integration page, the
   sidebar) colour projects with accent, teal and periwinkle, so a project can look "approved".
   See risk R6.
5. **The canvas uses nine tokens `theme.ts` lacks:** `accent-hover`, `state-review-text`,
   `annotation`, `annotation-text`, `avatar-text`, `scrim`, `shadow-popup`, `stage`, `glow`.
   Five of them have no group (`--circi-scrim`), which `tokenVariables()` can't emit today.
6. **Compare-mode keys.** Foundations says "1 to 4 switch compare modes"; Figma's Design mode is a
   fifth, so it becomes 5 (only when Figma is connected).
7. **`docs/linear-features-plan.md` is stale** in its keyboard map (Triage 1·2·3; no ⇧R, ⌘⇧C,
   B/I/M), its "SLA" wording (now "review target") and its open questions. Its item 7 says
   "existing Reviews page": `apps/web` has no Reviews page, nor any of the new screens.
8. **Code gaps the plan depends on:** builds have no author column; `packages/providers` has a
   `GithubApp` class, not an interface; `provider_connections.installation_id` is GitHub-shaped and
   required; `theme.test.ts` has no accent/rejected separation check; `STATUS_LABEL.neutral` is
   still "No changes"; Tooltip radius is 5 (canvas 8) and menu items 5 (canvas 6).

## 3. How the work runs

- **Spike, then fan out.** Each phase's item 0 is done first by one agent and reviewed by you. It
  fixes the pattern (file layout, naming, tests) that the parallel agents copy.
- **Parallel agents get disjoint files.** Every agent below lists the files it owns. Where two
  items touch the same file they are one agent.
- **One owner for shared outputs.** Drizzle migrations, `enums.ts`, `packages/api/src/index.ts`,
  `contract-check.ts` and the `ui-visual` baselines are regenerated by the lead when merging, in
  sequence, never by parallel agents (they collide on migration numbers and screenshot files).
  Agents write schema files and say "needs `pnpm db:generate`".
- **Each item ends green:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
  Commits only when you ask.
- Sizes: **S** under a day, **M** 1–3 days, **L** about a week, **XL** more than a week of agent work.

## 4. Phase A: `@circi/ui` and `theme.ts` match the canvas

Outcome: every component on the Components page exists in `@circi/ui` with the canvas's colours,
shapes, radii, densities and focus behaviour, in both schemes, with browser tests and fresh visual
baselines. No app screens change except where a renamed prop forces it.

| # | Item | Files | Depends on | Size | Tests |
|---|---|---|---|---|---|
| A0 | **Spike: the palette.** New state values (dark review `#eec84f`, rejected `#ff0a1f`; light review `#b38d05`, rejected `#930028`), `state.reviewText` (`#eec84f` / `#6b4c00`), `accent.hover`, and the ungrouped tokens (`annotation`, `annotationText`, `avatarText`, `scrim`, `shadowPopup`, `stage`, `glow`) under names that match the canvas exactly. Extend `tokenVariables()` so a group can emit `--circi-<key>` | `packages/ui/src/theme.ts`, `tokens-css.ts`, `test/theme.test.ts`, new `test/canvas-palette.json` | — | S | `theme.test.ts`: values equal `canvas-palette.json` (a copy of the canvas stylesheet's variables, so drift fails a test: review C4); ΔE(accent.main, state.rejected) ≥ 15 normal vision and ≥ 8 deuteranopia per scheme; `reviewText` 4.5:1 on panel and raised; state glyphs 3:1 (existing) |
| A1 | **StatusIcon shapes and labels.** `added` (ring and plus), `removed` (ring and minus), `flaky` (ring and tilde), paths from the StatusGlyph board; `STATUS_LABEL.neutral` → "Unchanged"; StatusChip labels (No changes, Uploading, Failed, Expired, No baseline) | `StatusIcon.tsx/.module.css`, `StatusChip.tsx`, their browser tests; `apps/web/src/features/builds/diff-status.ts`, `build-state.ts` and their tests | A0 | S | Browser tests per shape (role, name, `data-status`); `diff-status` logic test: pending added/removed/flaky use their own glyph, decided ones follow the review |
| A2 | **Focus, selection, radius, density.** Focus 2px `accent.text`, 2px out; rows inset 5px. Selected row: `accent.subtle` and a 2px bar. Radius tokens (4 inline, 6 controls and items, 8 popups and tooltips, 10 panels and dialogs, 12 command menu). `ListRow density="compact"|"default"|"two-line"` (32/44/56), group headers 32 | `global.css`, `ListRow`, `NavItem`, `Menu`, `Tooltip`, `Dialog`, `Select`, `SegmentedControl` (`.module.css` and tests) | A0 | M | Browser tests read computed styles: a focused selected row shows the ring and the bar; `density` sets min-height; Tooltip radius 8 |
| A3 | **New components and variants.** `Badge` (tone neutral, accent or state; shape count or tag; radius 4), `Switch` (Base UI; instant-apply settings only), `Pane` (preview pane: width tiers, context header, actions bottom-right), Button `toggle` (`aria-pressed`), `filter` chip, `select-trigger` | new `Badge`, `Switch`, `Pane` (`.tsx`, `.module.css`, browser tests, previews); `Button.tsx/.module.css`; `index.ts` | A0 | M | Browser tests: roles (`switch`, `button[aria-pressed]`), keyboard toggling, Pane landmarks; previews added to the `ui-visual` set |
| A4 | **Avatar, navigation parts, type.** Avatar initials in `avatar-text`, falling back on image error (already Base UI). `NavItem` gains an icon, a count (`Badge`) and a sub-item level (26px, indented). `NavSection` (label and items) for SettingsNav. Check `Text`/`Heading` against the compact scale (20/15/13/13/12/11) | `Avatar`, `NavItem`, new `NavSection`, `Text`, `Heading` (and tests) | A0 | S | Browser tests: count announced in the name ("Inbox, 3 unread"), section labelled, avatar falls back to initials when the image 404s |
| A5 | **Close the phase.** Regenerate `ui-visual` baselines for both schemes, update `.design-sync/conventions.md` and the `Provisional` doc comments that the canvas now settles, mark `design-gaps.md` sections done | `packages/ui/visual/**`, `.design-sync/`, `docs/design-gaps.md` | A1–A4 | S | `pnpm test:visual`, reviewed by you before merge |

**Parallel:** A0 alone (gate) → A1, A2, A3, A4 as four agents → A5 by the lead.

## 5. Phase B: backend and data model

Outcome: every screen in Phase C has its tables, repositories, services, routes, `@circi/api`
types and PGlite tests. Writes that cause notices go through services and the outbox (CLAUDE.md
layers). Ordered by the ship order.

| # | Item | Files | Depends on | Size | Tests |
|---|---|---|---|---|---|
| B0 | **Spike: review requests.** `review_requests` (build, reviewer, requested by, state open, done, superseded or dismissed, `due_at` from the project's review target, snooze fields). `requestReview` and auto-close of superseded requests in `finalizeBuild` (same branch, newer build). `reviewBuild` closes the build's requests. Overdue rule in `@circi/core` (pure). Dashboard routes and `Review.Request` wire types | `packages/db/src/schema/review-requests.ts`, `repositories/review-requests.ts`, `queries/reviews.ts`; `packages/services/src/reviews.ts`, `builds.ts`; `packages/core/src/review-target.ts`; `apps/server/src/http/routes/dashboard/reviews.ts`; `packages/api/src/review.ts`; seeders in `packages/testing/src/seed/reviews.ts` | — | M | Services test: request, then a newer build supersedes it, then approve closes it; core unit test for overdue at boundaries; route test via `app.inject` signed in through `/api/auth`; `layers.test.ts` still passes |
| B1 | **Build author.** `builds.author_login`, `author_email`, `author_user_id` (nullable). CLI reads `GITHUB_ACTOR`, `GITLAB_USER_LOGIN`, `BITBUCKET_STEP_TRIGGERER_UUID`, plus `--author`. The v1 and Argos routes accept it; the GitHub `pull_request` payload overrides it; matched to a member by better-auth `account` | `schema/builds.ts`, `repositories/builds.ts`, `packages/cli/src/ci-env.ts`, `upload.ts`, `routes/v1`, `routes/argos`, `github-webhook.ts`, `packages/api/src/build.ts` | — | S | CLI unit test per CI env; route test that the author lands; webhook test that PR author wins; Argos compat test unchanged |
| B2 | **Notifications.** `notifications` (user, kind, build, actor, payload, `read_at`, `snoozed_until`, `deleted_at`). Kinds: review requested or re-requested, mentioned, your build approved or rejected (with reason), overdue, connection needs attention, flaky detected. Written inside services' transactions. Cross-clearing: acting on a build in Reviews marks its notifications read; acting in Inbox closes the request. Per-user email preferences; worker email job (SMTP only) | `schema/notifications.ts`, `repositories/notifications.ts`, `queries/inbox.ts`, `services/src/notifications.ts` (+ hooks in `reviews.ts`, `builds.ts`), `apps/worker/src/jobs/send-email.ts`, `routes/dashboard/inbox.ts`, `packages/api/src/notification.ts` | B0, B1 | M | Services test per kind: notification exists exactly when the change commits (roll back → none); cross-clearing both ways; worker test with the SMTP fake |
| B3 | **Overdue sweep and snooze.** Periodic worker job marking overdue requests and notifying once; snooze (until next push, tomorrow, next week, date) for requests, notifications and triage items, one core helper | `apps/worker/src/jobs/review-sweep.ts`, `packages/core/src/snooze.ts`, `runner.ts` | B0, B2 | S | Core tests for each snooze option ("until next push" wakes on the next build on the branch); worker test that a sweep notifies once |
| B4 | **Search, filters, saved views, bulk, pins.** One search query (build number, branch, PR, project, snapshot name) for ⌘K. Builds query filters (status, branch, author, reviewer, build name, date) as URL params. `saved_views` (user, org, name, filter JSON, pinned). `reviewBuilds` bulk service in one transaction. `user_pinned_projects` | `queries/search.ts`, `queries/builds.ts`, `schema/views.ts`, `repositories/views.ts`, `services/src/reviews.ts` (bulk), routes | B1 | M | Query tests on seeded data per filter; bulk approve of 3 builds queues exactly 3 sets of notices; saved-view CRUD route tests |
| B5 | **Review rules and triage.** `review_rules` (project, snapshot-name or build-name glob, reviewers) resolved in `finalizeBuild` into review requests. Triage rotation on the project (members, weekly). Triage read model (flaky, no baseline, failed); `triage_items` state (assignee, snoozed, dismissed). Ignore-region writes from the dashboard | `schema/review-rules.ts`, `schema/triage.ts`, repositories, `queries/triage.ts`, `services/src/builds.ts`, `routes/dashboard/{rules,triage,ignore-regions}.ts`, `packages/core/src/rules.ts` | B0 | L | Core glob-matching tests; services test: rule → request on finalize; rotation picks this week's person; triage query on seeded flaky, orphan and failed builds |
| B6 | **Comments and activity.** `comments` (build, snapshot name, region rect, body, author, parent) with @mentions → notifications. Reject reason on `reviews`. Activity timeline query from `reviews.source`, `build_checks`, jobs and comments | `schema/comments.ts`, `schema/reviews.ts`, repositories, `queries/activity.ts`, `services/src/comments.ts`, routes, `packages/api/src/comment.ts` | B2 | M | Mention parsing in core; services test: a mention notifies, a self-mention doesn't; timeline query order |
| B7 | **Baselines and Insights.** Baselines read model (snapshots on the default branch with their source build). Insights aggregates: time to review, builds reviewed, change rate, flaky trend, storage per project, reviewer load | `queries/baselines.ts`, `queries/insights.ts`, routes, `packages/api/src/insights.ts` | B0, B1 | M | Query tests on seeded history with known answers |

**Parallel:** B0 alone (gate). Then B1, B5 and B7 start at once; B2 starts when B1 lands; B3, B4
and B6 follow B2/B1. In practice: wave 1 = B1, B5, B7; wave 2 = B2, B4; wave 3 = B3, B6. The lead
generates migrations and the contract check after each wave.

## 6. Phase C: web screens

Outcome: the Screens page is real, in ship order, in both schemes. Logic lives in each feature's
`api.ts` or `lib/` with Node tests; pages get `*.browser.test.tsx` rendered through
`apps/web/test/support/render.tsx` (no testing-library).

| # | Item | Files | Depends on | Size | Tests |
|---|---|---|---|---|---|
| C0 | **Spike: the shell and keyboard layer.** Sidebar to the canvas order (Search, Inbox, Reviews, Projects, Insights, Settings; pinned then A–Z projects with Builds, Triage, Baselines, Settings; Your views). Settings layout with the sectioned SettingsNav on every settings page; Members moves under Organisation. One shortcut registry: G-chords, `?`, ⌘K, J/K moving selection and focus together, ⌘⇧C | `apps/web/src/app/{Sidebar,Shell,router,shell-model}.tsx`, new `src/app/SettingsLayout.tsx`, `src/lib/shortcuts.ts` (from `features/builds/shortcuts.ts`), route moves in `features/members`, `features/account` | A, B4 (pins) | M | `shell-model` logic tests (ordering, counts); browser tests: G I goes to Inbox, J/K moves focus, settings pages share the nav |
| C1 | **Reviews.** Tabs (for you, created by you, snoozed), overdue badge, snooze menu, request review ⇧R, next item after approving | `features/reviews/` | C0, B0, B3 | M | `api.ts` tests; browser test: approve moves to the next item and clears the Inbox entry |
| C2 | **Inbox.** For you or Everything, read/unread (U), snooze (H), delete (⌫), "Also in Reviews" tag, Snoozed view, Pane | `features/inbox/` | C0, B2, B3 | M | Same pattern as C1 |
| C3 | **Build review updates.** Details, Activity and Comments tabs; region comments; reject with a reason; ⇧R; the new glyphs; Design mode slot (empty until D5) | `features/builds/*` | C0, B6 | M | Browser tests for the reject dialog and a comment on a region |
| C4 | **Builds list.** Filter chips, display options, saved views to the sidebar, peek (Space), select (X), bulk bar | `features/builds/BuildsList*`, `features/views/` | C0, B4 | L | `search.ts` round-trip tests (URL ↔ filters); browser tests: X then bulk approve |
| C5 | **⌘K and shortcuts help.** Command menu (jump, actions in context, quick look); `?` dialog grouped, generated from the registry | `features/command/`, `features/builds/ShortcutsDialog.tsx` → `src/app/` | C0, B4 | M | Registry test: every shortcut appears in help; browser test: ⌘K, type "#148", enter |
| C6 | **Triage.** Queue groups, filmstrip (with ~ glyphs for A3 of the review), accept, ignore region (I), assign to me (M), snooze (H), rotation chip | `features/triage/` | C0, B5 | M | Browser test for each action key |
| C7 | **Baselines** page | `features/baselines/` | C0, B7 | S | Browser test |
| C8 | **Settings pages.** Reviews and triage (rules, review target, auto-close); Account › Notifications and Appearance; Organisation › Storage and retention | `features/settings/*` | C0, B2, B5 | M | Form logic tests; browser tests for save |
| C9 | **Insights** | `features/insights/` | C0, B7 | M | Chart data shaping in `lib/` tested in Node; one browser test |

**Parallel:** C0 alone (gate). Then by ship order: wave 1 = C1, C2, C3; wave 2 = C4, C5, C6;
wave 3 = C7, C8, C9. Each wave runs as separate agents (disjoint feature folders); the router file
is edited by the lead.

## 7. Phase D: integrations

Outcome: organisation-level Integrations page and Add dialog, with GitHub, GitLab, Bitbucket,
Slack, Linear, Jira and Figma working. Azure DevOps, Teams and Penpot show as Planned. Every
external service is tested against a fake at its edge, and the docs say so.

**Missing designs first.** The canvas has a page for Figma only. Before D1, D3 and D4, the canvas
needs: git-host repository-to-project mapping, Slack channel mapping, and the Linear/Jira
team-or-project mapping and the "Create issue" dialog. That is a design task on the canvas
(not part of this plan's code work).

| # | Item | Files | Depends on | Size | Tests |
|---|---|---|---|---|---|
| D0 | **Spike: the integration model.** `GitProvider` interface (report status, upsert summary comment, verify webhooks, list repositories); `github.ts` implements it with no behaviour change. `provider_connections`: generic `external_id` and encrypted credentials (reuse the encryption the org OIDC secrets use). `integrations` and `integration_projects` tables. Integrations page and Add dialog listing GitHub; the project-level GitHub section goes | `packages/providers/src/{provider,github}.ts`, `schema/git.ts`, `schema/integrations.ts`, repositories, `apps/worker/src/jobs/notify-git.ts`, `features/integrations/`, remove `features/projects/GithubSection.tsx` | A, C0 | L | All existing GitHub tests pass unchanged; new interface contract test that any provider runs; route tests for the list |
| D1 | **GitLab.** MR status, one summary note, webhook verify, project mapping, sign-in (better-auth provider) | `packages/providers/src/gitlab.ts`, routes, `features/integrations/gitlab/` | D0, design | L | Contract test against a GitLab fake; e2e host fake |
| D2 | **Bitbucket.** Same shape as D1 | `bitbucket.ts`, … | D0, design | L | Same |
| D3 | **Slack.** OAuth install, channel per project, review requested, overdue and rejected notices through the outbox | `packages/providers/src/slack.ts` (or a new `packages/integrations`), worker job, `features/integrations/slack/` | D0, B2, design | M | Message formatting unit tests; worker test against a Slack fake |
| D4 | **Linear and Jira.** "Create issue" on a rejected snapshot with the diff attached; `issue_links` so the build shows the issue | `linear.ts`, `jira.ts`, `schema/issue-links.ts`, build review action | D0, B6, design | M | Fakes for both APIs; services test that the link is stored |
| D5a | **Figma: connect and link.** Connect, file per project, `figma_links` (pattern, file and node, how linked), auto-link by name; frame in the snapshot header and Peek | `figma.ts`, `schema/figma.ts`, `features/integrations/figma/` | D0 | M | Name-matching tests in core; route tests with a Figma fake |
| D5b | **Figma: Design compare.** Worker job exports a frame as PNG at the snapshot's size, cached by frame version; design diff reuses the comparison with its own threshold (default 2%), never blocking; the fifth viewer mode (key 5) | `apps/worker/src/jobs/render-figma.ts`, `packages/core` threshold, `DiffViewer.tsx` | D5a, C3 | L | Worker test with fixture PNGs; core test that design diffs never change the build's conclusion |
| D5c | **Figma: frames as first baselines.** A new snapshot with no baseline on main compares against its frame | baseline resolution (`packages/core` baselines, process-build) | D5b | M | Baseline-resolution tests: frame used only when no baseline exists; replaced on first approval |
| D5d | **Figma: post results.** Approve or reject comments on linked frames, through the outbox | `services/src/reviews.ts`, worker job | D5a, B2 | S | Outbox test with the Figma fake |

**Parallel:** D0 alone (gate). Then D1, D2, D3, D4 and D5a as five agents; D5b to D5d follow D5a
in sequence.

## 8. Dependencies at a glance

```
A0 ─► A1 A2 A3 A4 ─► A5 ──────────────┐
B0 ─► B1 B5 B7 ─► B2 B4 ─► B3 B6 ─────┤  (B runs alongside A; it has no UI)
                                      ▼
                  C0 ─► C1 C2 C3 ─► C4 C5 C6 ─► C7 C8 C9
                  C0 + A ─► D0 ─► D1 D2 D3 D4 D5a ─► D5b ─► D5c, D5d
```

Phase B needs nothing from A, so B0 can start in parallel with A0. Phase C needs A finished and
the matching B items. D needs A, C0 and its listed B items.

## 9. Risks and cuts

| # | Risk | What to do |
|---|---|---|
| R1 | **Figma is the largest item** (XL across D5a–d) and D5b–c touch the core diff and baseline path | Ship D5a and D5d first; D5c (frames as first baselines) is the first thing to cut or defer |
| R2 | **Triage "Accept as baseline"** for a snapshot from a branch build conflicts with the rule that the default branch is the baseline (PLAN §7.2) | Define it before B5: either "approve this build's snapshot as the baseline for every branch" (a new per-snapshot baseline override) or limit it to builds on main. Until then, cut the action for branch builds |
| R3 | **Parallel migrations collide** on Drizzle's journal | Lead-only migration generation per wave (section 3) |
| R4 | **Gravatar leaks email hashes** to a third party from a self-hosted instance, and needs `img-src` in the CSP | Instance setting (default on, off for air-gapped installs); computed on the server; the sign-in account picture always wins |
| R5 | **Dark rejected is borderline for deuteranopia** (ΔE 8.0 from clay) | Shape carries it (filled cross); the A0 separation test pins it so it can't get worse |
| R6 | **Project tiles reuse state colours**, against "state colour only for state" | Add a small categorical project palette (4–6 tokens, not state hues) in A0, and update the canvas later |
| R7 | **Subscriptions** (feature 11) overlap with notifications and Slack | Cut; Slack channels and notifications cover it |
| R8 | **Interactive boards were never click-tested** in every state; Overlays popup clipping untested | Treat board behaviour as intent; the browser tests in Phase C are the real check |
| R9 | **Visual baselines churn** with every palette and radius change | Regenerate once per phase (A5, end of each C wave), reviewed by you |
| R10 | **External services only faked** (GitLab, Bitbucket, Slack, Linear, Jira, Figma, SMTP) | Say so in each integration's docs; one manual test against each real service before release |

- **R11 (found in A0, your call):** the canvas's light review amber `#b38d05` is 3.0:1 on the panel
  and 3.1:1 on raised, but 2.7:1 on chrome and 2.5:1 on highest, below the 3:1 the palette test
  asks of glyphs. `theme.ts` matches the canvas, and the test checks review only where it is
  drawn (panel, raised). If a review glyph ever appears on the sidebar or a highest surface,
  darken it (about `#a07c04` passes 3:1 on all four) and update the canvas.

## 10. Doc housekeeping

- Done 2026-11-08: the review doc's Decision column says "Fix" for all 41 findings.
- Done 2026-11-08: `docs/linear-features-plan.md` has the current keyboard map, "review target"
  instead of SLA, the resolved questions, and the Reviews page marked as new.
- To do: update the Foundations note on the canvas that says crimson and amber "still need to land in
  theme.ts" once A0 is merged.
