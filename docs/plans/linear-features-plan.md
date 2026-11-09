# Linear-style workflows: plan

Status: 2026-11-08. Design first, on the CirCI Design System canvas
(https://claude.ai/artifact/WiAjMhRumRaiSMaYTeNc39), section "Linear-style workflows". Nothing
below is built; each item lists the backend it needs so the designs don't promise data we lack.

The idea: CirCI already looks like Linear. These features make it *work* like Linear, mapped onto
visual review instead of issues. Linear's Cycles, Initiatives, Priority and Templates have no
analogue and are skipped.

## The navigation they share

One sidebar for every screen (`Sidebar.dc.html`, imported by each board):

```
acme ▾                       +
Search                     ⌘K
Inbox                       3      notifications for you
Reviews                     4      builds waiting on your review
Teams
Insights
Settings                           account · workspace · team, one tree
Your views
  Failing on main                  saved views, pinned
  My open PRs
Teams
  web-app
    Builds
    Triage                  3      per-team queue
    Baselines
    Settings
  storybook
  marketing-site
Michael Hazan
```

Members moves under Settings (workspace). Counts appear only for work waiting on you; accent
for Inbox and Reviews, neutral for Triage.

## The features

| # | Feature (Linear) | CirCI screen | Board | Backend it needs |
|---|---|---|---|---|
| 1 | Inbox | Notifications: review requested / re-requested, @mention, your build approved or rejected (with reason), review overdue, GitHub app broken, flaky detected. Tabs For you / Everything; read, snooze, delete | `Inbox.dc.html` | `notifications` table written inside the services' transactions (outbox), worker job for email |
| 2 | Triage + responsibility | Per-team queue: Flaky, No baseline, Failed, Integration. Accept as baseline, add ignore region, assign, snooze, dismiss. "On triage" rotation | `Triage.dc.html` | read model in `db/queries`; ignore-region writes from the web (today CLI only); `triage_snoozes`; rotation on the team |
| 3 | Command menu ⌘K + quick look | Jump to `#148`, branch, PR, team; actions in context; quick look on → | `Command.dc.html` | one search endpoint in `db/queries`; the rest is web |
| 4 | Filters, Display options, Custom views | Builds list: filter chips (status, branch, author, reviewer, build name, date), display popover (group, order, properties), Save view → sidebar | `BuildsViews.dc.html` | query params on the builds query (PLAN §7.5); `saved_views` table later, URL-encoded filters first |
| 5 | Peek, bulk actions | Space previews a build; X selects; bottom bar Approve / Reject / Request review | `BuildsViews.dc.html` | loop over `reviewBuild` in one service call |
| 6 | Comments, @mentions, activity | Build review sidebar tabs Details / Activity / Comments; comments pinned to a snapshot region; reject asks for a reason | `Activity.dc.html` | `comments` table, mentions feed notifications; timeline reads `reviews.source`, `build_checks`, jobs |
| 7 | Reviews (Diffs) | A new Reviews page (`apps/web` has none yet): For you, Created by you and Snoozed tabs, overdue badge, the one snooze menu, superseded requests closed | `Reviews.dc.html` | `review_requests` table + `requestReview` service; build author from CI or the GitHub user |
| 8 | Triage rules / assignment | Review rules: snapshot-name or build-name patterns → reviewers; fallback rotation | `ReviewSettings.dc.html` | `review_rules` on the team, resolved in `finalizeBuild` |
| 9 | Review target (SLAs) | A review target per team (24h by default); a missed one shows "Overdue Xh" in Reviews and Inbox and can escalate to someone | `ReviewSettings.dc.html`, Reviews, Inbox | rule in `@circi/core`, team setting, worker sweep |
| 10 | Auto-close | Close review requests when a newer build on the same branch arrives (PLAN §7.4 "superseded") | `ReviewSettings.dc.html`, Reviews | service-side, in `finalizeBuild` |
| 11 | Subscriptions, Slack | Watch a team or branch; webhook payload format Slack | `BuildsViews.dc.html` (Watch), `ReviewSettings.dc.html` (format) | `subscriptions` table; Slack formatter beside webhook signing |
| 12 | Settings structure | One settings sub-nav: Account · Workspace · Team | `ReviewSettings.dc.html` | design only |
| 13 | Insights | Time to review, builds reviewed, change rate, flaky trend, storage per team, reviewer load | `Insights.dc.html` | aggregate queries (PLAN M4 storage page and metrics) |
| 14 | Keyboard shortcuts help | `?` opens every shortcut, grouped | `Shortcuts.dc.html` | design only (remaining-work §3) |

## Keyboard map (one table, used by every board)

| Keys | Where | Does |
|---|---|---|
| ⌘K | everywhere | command menu |
| ? | everywhere | shortcuts help |
| G I · G R · G P · G T · G S | everywhere | go to Inbox, Reviews, Teams, Triage, Settings |
| J / K | lists | move |
| ↵ | lists | open |
| Space | lists | peek |
| X | lists | select |
| F | lists | filter |
| ⇧V | lists | display options |
| U | Inbox | read / unread |
| H | Inbox, Triage, Reviews | snooze (one menu: Until next push, Tomorrow, Next week, Custom date) |
| ⌫ | Inbox | delete |
| B · I · M | Triage | accept as baseline · ignore region · assign to me |
| A · ⇧A · R | Build review | approve snapshot · approve all · reject |
| ⇧R | Build review, lists | request review |
| 1 – 4 | Build review | compare modes (5 = Design, when Figma is connected); number keys do nothing else |
| C | Build review | comment |
| ⌘⇧C | everywhere | copy link |

J and K move the selection, and focus follows it.

## Order of work

The order below was the design order. The build order is in `docs/plans/next-steps-plan.md`.

1. Sidebar (shared component) and the canvas index.
2. Inbox, Triage, Command menu.
3. Builds with views / peek / bulk, Build activity and comments, Insights.
4. Review settings (rules, review target, auto-close, Slack, settings tree), Shortcuts help.
5. Reviews update (Created by you, overdue, snooze, superseded).

## Resolved questions (2026-11-08)

- **Build author:** the CLI sends it at upload (`GITHUB_ACTOR`, the CI's own variable, or
  `--author`); a connected git host's PR author replaces it; it is matched to a member through
  their linked sign-in account.
- **Email:** in-app by default. Email only for "review requested" and "overdue", only when SMTP is
  configured, and each user can turn it off.
- **Triage rotation:** per team (Triage itself is per team; workspace-wide problems go
  to the Inbox and a workspace banner).
- **After approving from Inbox or Reviews:** move to the next item.

## Integrations (added 2026-11-08)

Design: canvas › Screens › "7 · Integrations" (Integrations, the Add dialog, Figma integration,
Build review · Design mode, each with a light twin). Nothing is built.

Integrations belong to the **workspace**; teams have no integration settings of their own
(the team's "GitHub" settings item goes away). Workspace settings › **Integrations** lists only
the integrations that have been added, grouped by kind, each with its provider's logo.
**Add integration** opens a dialog listing every available integration (searchable, filterable by
group); adding one connects it and puts it on the list. Each integration's own page maps it to
teams: which repository, channel, tracker team or Figma file each team uses.

| Group | Providers | What CirCI does |
|---|---|---|
| Git hosts | GitHub (exists), GitLab, Bitbucket, Azure DevOps | Build status on the PR/MR, one summary comment, sign-in with the host account. One repository per team. |
| Chat | Slack, Microsoft Teams | Review requested, overdue and rejected events to a channel per team (replaces the Slack webhook format). |
| Design tools | Figma (Penpot planned) | See below. |
| Issue trackers | Linear, Jira | "Create issue" on a rejected snapshot, with the diff attached; the build links to the issue. |

**Figma** (all four uses):

1. *Link*: a snapshot links to a Figma frame (auto-linked by name, or by hand); the frame shows in
   the snapshot header and in Peek.
2. *Design compare*: a fifth viewer mode, Design, puts this build beside its frame and marks the
   differences. Design and build are never pixel-equal, so design differences have their own
   threshold (default 2%) and never block a build or its check.
3. *Frames as first baselines*: a new snapshot with no baseline on main is compared with its frame
   instead of showing as Added; the first approved build replaces it.
4. *Post results*: approving or rejecting a build comments on the linked frames, linking back.

**Backend it needs**

- `packages/providers`: a `GitProvider` interface (report status, upsert the summary comment,
  verify webhooks, list repositories) that `github.ts` implements first; then `gitlab.ts` and
  `bitbucket.ts` (`azure-devops.ts` once it is more than Planned). `render.ts` stays shared.
- `packages/db`: widen `GIT_PROVIDER_KINDS`; `provider_connections.installation_id` becomes a
  generic external id plus encrypted credentials for token-based hosts. New `integrations` table
  for non-git connections (kind, workspace, credentials, needs-attention, as git connections have),
  `integration_teams` (integration, team, external ref: repository, channel, tracker team or
  Figma file; owned by the workspace's integration, not the team), and
  `figma_links` (team, snapshot name pattern, Figma file/node id, how linked).
- `packages/services`: Figma comment posting and chat/issue notices go through the existing outbox,
  queued in `reviewBuild` / `completeBuild`, like webhooks today.
- `apps/worker`: a Figma render job (export a frame as PNG at the snapshot's size, cache by the
  frame's version) feeding a design-diff that reuses the image comparison with its own threshold.
- `REVIEW_SOURCES` (`reviews.source`) gains the new hosts' check and comment sources.

**Resolved questions (2026-11-08)**

- **Figma comments** are posted through the workspace's connection, naming the reviewer in the
  text. A per-user Figma sign-in can come later.
- **A design difference never fails the check.**
- **A frame as first baseline** needs no approval of its own: linking it is enough, and the first
  approved build replaces it.
- **Built for real:** GitHub, GitLab, Bitbucket, Slack, Linear, Jira and Figma. Azure DevOps,
  Microsoft Teams and Penpot stay "Planned" tiles in the Add dialog with no backend
  (`docs/plans/next-steps-plan.md`).
