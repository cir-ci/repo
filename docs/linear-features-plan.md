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
Projects
Insights
Settings                           account · organisation · project, one tree
Your views
  Failing on main                  saved views, pinned
  My open PRs
Projects
  web-app
    Builds
    Triage                  3      per-project queue
    Baselines
    Settings
  storybook
  marketing-site
Michael Hazan
```

Members moves under Settings (organisation). Counts appear only for work waiting on you; accent
for Inbox and Reviews, neutral for Triage.

## The features

| # | Feature (Linear) | CirCI screen | Board | Backend it needs |
|---|---|---|---|---|
| 1 | Inbox | Notifications: review requested / re-requested, @mention, your build approved or rejected (with reason), review overdue, GitHub app broken, flaky detected. Tabs For you / Everything; read, snooze, delete | `Inbox.dc.html` | `notifications` table written inside the services' transactions (outbox), worker job for email |
| 2 | Triage + responsibility | Per-project queue: Flaky, No baseline, Failed, Integration. Accept as baseline, add ignore region, assign, snooze, dismiss. "On triage" rotation | `Triage.dc.html` | read model in `db/queries`; ignore-region writes from the web (today CLI only); `triage_snoozes`; rotation on the project |
| 3 | Command menu ⌘K + quick look | Jump to `#148`, branch, PR, project; actions in context; quick look on → | `Command.dc.html` | one search endpoint in `db/queries`; the rest is web |
| 4 | Filters, Display options, Custom views | Builds list: filter chips (status, branch, author, reviewer, build name, date), display popover (group, order, properties), Save view → sidebar | `BuildsViews.dc.html` | query params on the builds query (PLAN §7.5); `saved_views` table later, URL-encoded filters first |
| 5 | Peek, bulk actions | Space previews a build; X selects; bottom bar Approve / Reject / Request review | `BuildsViews.dc.html` | loop over `reviewBuild` in one service call |
| 6 | Comments, @mentions, activity | Build review sidebar tabs Details / Activity / Comments; comments pinned to a snapshot region; reject asks for a reason | `Activity.dc.html` | `comments` table, mentions feed notifications; timeline reads `reviews.source`, `build_checks`, jobs |
| 7 | Reviews (Diffs) | Existing Reviews page gains: Created by you tab, overdue badge, snooze until next build, superseded requests closed | `Reviews.dc.html` (edit) | `review_requests` table + `requestReview` service; build author from CI or the GitHub user |
| 8 | Triage rules / assignment | Review rules: snapshot-name or build-name patterns → reviewers; fallback rotation | `ReviewSettings.dc.html` | `review_rules` on the project, resolved in `finalizeBuild` |
| 9 | SLAs | "Flag reviews waiting longer than 24h", escalate to someone; badge in Reviews and Inbox | `ReviewSettings.dc.html`, Reviews, Inbox | rule in `@circi/core`, project setting, worker sweep |
| 10 | Auto-close | Close review requests when a newer build on the same branch arrives (PLAN §7.4 "superseded") | `ReviewSettings.dc.html`, Reviews | service-side, in `finalizeBuild` |
| 11 | Subscriptions, Slack | Watch a project or branch; webhook payload format Slack | `BuildsViews.dc.html` (Watch), `ReviewSettings.dc.html` (format) | `subscriptions` table; Slack formatter beside webhook signing |
| 12 | Settings structure | One settings sub-nav: Account · Organisation · Project | `ReviewSettings.dc.html` | design only |
| 13 | Insights | Time to review, builds reviewed, change rate, flaky trend, storage per project, reviewer load | `Insights.dc.html` | aggregate queries (PLAN M4 storage page and metrics) |
| 14 | Keyboard shortcuts help | `?` opens every shortcut, grouped | `Shortcuts.dc.html` | design only (remaining-work §3) |

## Keyboard map (one table, used by every board)

| Keys | Where | Does |
|---|---|---|
| ⌘K | everywhere | command menu |
| ? | everywhere | shortcuts help |
| G I · G R · G P · G T · G S | everywhere | go to Inbox, Reviews, Projects, Triage, Settings |
| J / K | lists | move |
| ↵ | lists | open |
| Space | lists | peek |
| X | lists | select |
| F | lists | filter |
| ⇧V | lists | display options |
| U | Inbox | read / unread |
| H | Inbox, Triage, Reviews | snooze |
| ⌫ | Inbox | delete |
| 1 · 2 · 3 | Triage | accept as baseline · ignore region · assign |
| A · ⇧A · R | Build review | approve snapshot · approve all · reject |
| C | Build review | comment |

## Order of work

1. Sidebar (shared component) and the canvas index.
2. Inbox, Triage, Command menu.
3. Builds with views / peek / bulk, Build activity and comments, Insights.
4. Review settings (rules, SLA, auto-close, Slack, settings tree), Shortcuts help.
5. Reviews update (Created by you, overdue, snooze, superseded).

## Open questions

- Who is a build's author? CI env (`GITHUB_ACTOR`) at upload, or the PR author from the GitHub app.
- Do notifications email by default, or only in-app?
- Is the triage rotation per project or per organisation?
- Should approving from Inbox or Reviews jump to the next item (Linear's answer) or stay?
