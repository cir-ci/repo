# Duplication review: where the repo repeats itself and how to group it

Read-only analysis, 2026-11-09. Evidence comes from ripgrep counts, a throwaway duplicate-block
detector (hash of normalised 6-line windows over `src/**/*.ts(x)`, plus a normalised CSS
declaration-block hash over every `*.css`; the scripts and their output were deleted afterwards),
line counts and reading the clusters. Line counts are non-test source unless noted. "Saved" is
net of the new abstraction. Working tree has other agents' uncommitted edits; line numbers can
drift by a few lines.

Size of the codebase for scale (non-test src): web 22.6k TS + 3.8k CSS, db 10.4k, server 7.7k,
ui 3.3k TS + 2.4k CSS, providers 2.5k, services 2.1k, integrations 2.0k, worker 1.2k.

## Summary: what the evidence says

The backend is already well factored in several places the brief asked about, so do not spend
effort there:

- **Webhooks for the three git hosts are already one route** (`routes/integration-webhook.ts`, 90
  lines) plus one handler (`handleGitEvents`). Only the per-host verify/parse differ, and that
  difference is real.
- **The integration SDK already shares connect/verify/classify code**: `git-support.ts`
  (`connectFailure`, `derivedWebhookSecret`, `stubbed`) and `tracker-support.ts`
  (`identifyAccount`, `trackerTargets`, `trackerAttention`). Remaining repetition is small (C6).
- **Cursors: there are only two**, not five. `listBuildsForProject` pages by `beforeNumber`
  (`queries/builds.ts:100`) and `listBuildsForWorkspace` by `before` build id with a
  `(createdAt, id)` row comparison (`queries/workspace-builds.ts:45-88`). Reviews, inbox, activity,
  comments and triage are unpaginated lists. No shared cursor helper is justified (trap T1).
- **Config is already consolidated** (one `tsconfig.base.json`, root `vitest.config.ts`, `#alias`
  imports). Only three `onLog` blocks repeat (C14, quick win, tiny).

The real duplication is concentrated in six places, in order of lines saved:

| # | Cluster | Evidence (count) | Est. lines saved | Size |
|---|---------|------------------|------------------|------|
| C1 | Route access boilerplate (load project/workspace/build, 404/403, `if (!found) return reply`) | 50 `if (!found) return reply`, 79 inline 404/403 replies, 11 local `load*` helpers, 16 owner-or-admin checks | ~350 | M |
| C2 | Web CSS: repeated blocks and four near-identical settings page stylesheets | 47 identical blocks (82 redundant copies), 110 `flex-direction: column` rules vs 5 `<Stack>` uses | ~450 CSS | M |
| C3 | Web page scaffolding: loading/error ternary, four Frame components, query-state | 20 `<ListSkeleton>` + 24 `<ErrorState>`; 4 Frames | ~200 | M |
| C4 | Provider HTTP clients (`#call` in 7 adapters) + `record/str/isRecord` helpers (9 copies) | 7 hand-written fetch wrappers | ~150 | M |
| C5 | Web api.ts: URL builders, `refresh` after mutate | 53 `/api/(projects|workspaces)/${seg(..)}` literals in 17 files; 97 `useMutation`, 64 `invalidateQueries` | ~150 | S-M |
| C6 | Worker `run*Job` try/complete/catch/fail blocks | 5 copies of 20-25 lines | ~80 | S |
| C7 | Web list pages (Inbox, Reviews, Triage) selection/peek/settle logic | 3 pages x ~45 lines | ~100 | M |
| C8 | api vs db/queries hand-mirrored types | ~12 interface pairs, 42 `Fits<>` assertions | up to ~500 | L |

Everything else is S-sized (dialogs, secrets, role checks, not-found throws).

---

## C1. HTTP routes: access checks and error replies (apps/server)

### Evidence

`http/lib/project-access.ts` (`loadProject`) and `workspace-access.ts` (`loadWorkspace`) exist and are
the right idea, but they **reply and return `undefined`**, so every caller must write
`if (!found) return reply`. Counts under `apps/server/src/http/routes`:

- `if (!found) return reply`: 50 (`rules.ts` has 7, `views.ts` 11, `reviews.ts` 8).
- `await loadProject(` 17 calls, `await loadWorkspace(` 12 calls.
- Inline `reply.code(404).send({ error: '… not found' })`: 79 (404s for Project 8x, Workspace 6x,
  Build 7x, Integration 4x, Webhook 3x, Rule 2x).
- 11 route-local helpers re-implement loading with a slightly different shape:
  `integrations.ts:25 load` + `:35 loadForManager`, `settings.ts:146 load` + `:164 loadForManager`,
  `integrations-generic.ts:149 loadForManager`, `workspace-settings.ts:38 load`,
  `workspace-auth.ts:36 load`, `domains.ts:45 managed`, `workspace-sso.ts:35 managed`,
  `comments.ts:39 loadBuild`, `issue-trackers.ts:71 loadBuild`.
- Raw `findProjectForMember(...)` blocks that bypass `loadProject`: `baselines.ts:17-24`,
  `reviews.ts:38`, `:84`, `:182`, `:213`, `project-sites.ts:18`, `:56`, `views.ts:60-68`,
  `:122-128` (9 blocks of ~7 lines). The detector found the 7-line `const p = parse(...); const
  user = currentUser(req); const project = await findProjectForMember(deps.db, {...})` cluster x10.
- `workspaceAcceptsSession + getMemberRole + getWorkspaceBySlug` re-done by hand in
  `domains.ts:45`, `workspace-sso.ts:35`, `workspace-settings.ts:38`, `workspace-auth.ts:36` (x4
  identical per the detector) instead of calling `loadWorkspace`.
- `role === 'owner' || role === 'admin'`: 16 occurrences in server (`comments.ts:56`,
  `integrations.ts:32`, `settings.ts:161`, `integrations-generic.ts:138,693`, `rules.ts:48`,
  `workspace-auth.ts:54`, `workspace-settings.ts:56` ...) and `canManage` is derived the same way
  in 84 web places. No helper in `@circi/core`.
- The same params schema declared 25 times: `z.object({ workspace: z.string() })` x9,
  `z.object({ workspace, project })` x8, `{ workspace, project, number }` x5 (`activity.ts:10`,
  `comments.ts:17`, `issue-trackers.ts:22`, `reviews.ts:22`, `projects.ts:21`).
- Build-by-number parsing (`Number(...)`, `Number.isInteger`, `getBuildByNumber`, 404) repeated in
  `comments.ts:45`, `activity.ts:20`, `reviews.ts:48,192`, `issue-trackers.ts:76`, `projects.ts:89`.
- `jsonErrorHandler` (`http/lib/errors.ts`) **already maps** `NotFoundError` to 404 `{ error }`,
  `ForbiddenError` to 403 and `ValidationError` to 400 for every dashboard scope. The loaders
  ignore that and hand-roll the identical replies.

### Proposal

Make the loaders **throw** the domain errors the handler already maps, return the value, and add
the missing loaders. All of it in `apps/server/src/http/lib/` (same layer as today).

```ts
// http/lib/project-access.ts (changed)
export async function loadProject(deps, req, options?: { manage?: boolean }):
  Promise<{ project: Project.Visible; user: SessionUser; canManage: boolean }>   // throws NotFoundError / ForbiddenError

// http/lib/project-access.ts (new)
export const projectParams = z.object({ workspace: z.string(), project: z.string() })
export const buildParams = projectParams.extend({ number: z.string() })
export async function loadBuild(deps, req, options?):    // project + build by :number, throws NotFoundError('Build not found')
  Promise<{ project; user; build; canManage }>

// http/lib/workspace-access.ts (changed + new)
export async function loadWorkspace(deps, req, options?: { manage?: boolean }):
  Promise<{ workspace; user; canManage: boolean }>                        // 'Only owners and admins can change this'
export const workspaceParams = z.object({ workspace: z.string() })

// packages/core/src/roles.ts (new, pure)
export const canManage = (role: string | undefined): boolean => role === 'owner' || role === 'admin'
```

Call sites become `const { project, user } = await loadProject(deps, req, { manage: true })` with no
reply handling. The 11 local helpers collapse into `loadWorkspace(..., { manage: true })`
(integration routes keep a 403 message through an option `forbidden?: string`, because
`integrations-generic.ts:158` says "Only owners and admins can manage integrations" and tests may
assert it; check `apps/server/test/http/routes/dashboard/integrations*.test.ts`).
Route-specific lookups (`getIntegration`, `getWebhook`, rule by id) throw `NotFoundError('X not
found')` from a handler-local `orNotFound(value, 'Webhook')` helper (see C10) instead of 79 reply
blocks.

Replaces: all 50 `if (!found) return reply`, the 9 raw `findProjectForMember` blocks, the 4 hand
copies of workspace loading, 11 local helpers, 25 params schemas, ~35 of the 79 inline 404s, 16
owner/admin checks (plus `canManage` in web through `@circi/core`).
Estimated: ~350 lines removed. Risk: low-medium. Behaviour must stay identical: a non-member
gets 404 not 403 (keep that ordering in `loadProject`), and `loadProject` is used by `/v1`
(`routes/v1/index.ts`, `argos/index.ts`)? Those use their own token auth: leave them out. Tests
(`apps/server/test/http/routes/**`) assert statuses and bodies, so they cover this. Size M.

Do first: change the two loaders, then migrate route files in batches (they are disjoint files).

### Also in routes

- **Dates to ISO**: 43 `.toISOString()` in route/lib files plus `?.toISOString() ?? null`
  (`settings.ts:101-126`, `comments.ts:69-71,107`, `issue-trackers.ts:103`, `ignore-regions.ts:36`,
  `insights.ts:14 const iso`). Add `iso(d)` / `isoOrNull(d)` in `http/lib/presenters.ts` (S, ~40
  lines saved of noise, mostly readability). Do not build a generic deep-`Json<T>` mapper at
  runtime: `contract-check.ts` has the type-level one and the hand mapping documents intent.
- **Route registration list** (`dashboard/index.ts:84-117`, 34 `await api.register(x, deps)`):
  replace with `for (const plugin of [..]) await api.register(plugin, deps)`: saves ~25 lines but
  loses nothing; reviewers lose grep-ability of "where is X registered". Optional (S).
- **Route path strings**: `'/projects/:workspace/:project` appears 45 times and `'/workspaces/:workspace`
  40. Constants (`const PROJECT = '/projects/:workspace/:project'`) or `app.register(plugin, { prefix })`
  per file would shorten lines; the wrapper-plugin rule in CLAUDE.md for prefixes makes this a
  readability change, not a deduplication win. Skip unless C1 is done in the same file (S).
- **Filter parsing** is already shared (`lib/build-filters.ts`, one `buildFilterShape` for list
  query and saved views). Nothing to do.
- `apps/server/src/cli/admin.ts` (611 lines, 41 `console.log/process.exit/stdout`) is long but is
  commander command declarations, each different. Leave.

---

## C2. Web CSS (apps/web, packages/ui)

### Evidence (CSS block hash, blocks with >= 3 declarations, identical after sorting)

47 distinct blocks are repeated, 82 redundant copies in total. Largest groups:

- `display:flex; flex-direction:column; gap:12px` x12, `gap:16px` x8, `gap:6px` x5, plus
  `min-width:0` x4: `Admin.module.css:10,84,165`, `Integrations.module.css:11,237,243`,
  `Settings.module.css:10,16`, `InviteForm.module.css:1`, `AuthForms.module.css:1`, ...
  `Stack` exists (`packages/ui/src/Stack.tsx`, gap steps 4px) but is used in **5** places while
  web has **110** `flex-direction: column` rules.
- Truncate (`flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) x5 +
  x2 variants: `SettingsNav.module.css:1`, `Projectswitcher.module.css:88`,
  `WorkspaceSwitcher.module.css:32`, `UserMenu.module.css:27`, `NavItem.module.css:55`,
  `BuildReview.module.css:36`, `Menu.module.css:69`. 7 in ui, 11 in web use the ellipsis trio.
- Visually hidden text in **six** hand-written variants (two flavours: `clip-path: inset(50%)`
  and `clip: rect(0,0,0,0)`): `Insights.module.css:130`, `Links.module.css:43`,
  `CommandDialog.module.css:53`, `Drawer.module.css:65`, `Announcer.module.css:1`,
  `NavItem.module.css:43`.
- Bordered list/box surface (`border:1px solid var(--circi-line-subtle); border-radius:8px
  (sometimes 10px); overflow:hidden`) x7 across `MembersPage`, `EmailDomains`, `WorkspaceSso`,
  `ProjectSitesPage`, `ProjectPage`, `ProjectsPage`, `WebhooksPage`, `Settings.module.css:63 .box`,
  `ProjectSettings.module.css:17 .box`, `IgnoreRegionsPage.module.css:17`, `ListPage.module.css:37`,
  `BuildsBrowser.module.css:6`. Radius is 8px in some and 10px in others for the same thing.
- Dialog backdrop and viewport identical in `ConfirmDialog.module.css:1,17` and
  `Dialog.module.css:1,17` (13 declarations each).
- The four feature stylesheets for "settings style" pages define the same vocabulary:
  `Settings.module.css`, `Admin.module.css`, `Integrations.module.css`, `ProjectSettings.module.css`
  all contain `.content .section .fields .box .boxRow .boxDanger .row .rowText .footer .list
  .intro` with the same bodies (`.boxRow` x2 identical 7-declaration block, `.box` x3).
- Smaller: `.groupHeader` x2 (`BaselinesPage`, `TriagePage`), `.textarea` x2 (`Discussion`,
  `BulkRejectDialog`), title typography (15px/600/1.4) x3 in `ConfirmDialog`, `Dialog`,
  `ProjectSettings`, `EmptyState` + `ProjectsEmpty`, the 9-declaration annotation tag in
  `RegionLayer.module.css:30` and `RegionStage.module.css:31`.
- Counts of repeated rule kinds: `:focus-visible` 21 ui + 13 web, `outline:` 27 + 15,
  `prefers-reduced-motion` 17 in ui (each transition guarded separately), `border-radius` 47 + 71.

### Proposal

1. **`@circi/ui` `SettingsPage` building blocks** (new `packages/ui/src/Settings*.tsx` or, since
   they are layout of the dashboard only, `apps/web/src/lib/settings-ui/` with one
   `settings.module.css`): `SettingsSection`, `SettingsBox` (+ `tone="danger"`), `SettingsRow`
   (`.row/.rowText/.trailing`), `SettingsFields`, `SettingsFooter`. The four settings CSS files
   then keep only page-specific classes. Estimated ~200 CSS lines + ~60 className plumbing.
   Location: web, because `@circi/ui` is generic design system (CLAUDE.md) and these encode the
   dashboard's settings layout. Risk: low, visual-regression tests exist (`packages/ui/visual`).
   Size M. The 10px vs 8px box radius must be decided once (design call).
2. **Adopt `<Stack>` / utility for the 12+8+5 column-gap blocks**: ~35 rules replaced by
   `<Stack gap={3}>` where the element is a plain div. Where the class also carries other
   declarations, leave it. ~120 CSS lines. Mechanical but touches many tsx files: do it per
   feature dir to keep agents disjoint. Size M.
3. **Global utilities in `packages/ui/src/global.css`**: `.srOnly` (replacing 6 variants; export
   a `VisuallyHidden` component for use from tsx), `.truncate`. CSS modules cannot `composes`
   from global, so export `VisuallyHidden` and `Truncate` components or use `composes:` from a
   shared `utilities.module.css` in ui (`composes: truncate from '@circi/ui/utilities.module.css'`
   works in CSS modules). ~60 lines. Size S.
4. **`Surface` already exists** (`Surface.module.css`): check whether the bordered-list blocks can
   be `<Surface bordered>`; if `Surface` already has a raised/subtle variant, using it removes the
   x7 and x4 groups (~70 lines). Verify before adding anything new.
5. **ui internals**: share backdrop/viewport between `Dialog` and `ConfirmDialog` by having
   `ConfirmDialog` import `Dialog.module.css` classes (or `composes`), ~30 lines. A
   `focus-ring` mixin: not available in plain CSS modules without a build step; the repeated
   `:focus-visible { outline: 2px solid var(--circi-focus); outline-offset: 2px }` could become
   `composes: focusRing from './focus.module.css'` (verify the current rules are in fact
   identical first: `rg -n -A3 ':focus-visible' packages/ui/src/*.css`). Size S-M.

Total ~450 lines of CSS, plus the clarity of one settings vocabulary.

---

## C3. Web page scaffolding: loading / error / not found, and the four Frames

### Evidence

- The ternary `error ? <ErrorState .../> : !data ? <Delayed><ListSkeleton/></Delayed> : ...` appears
  in 20 files (`<ListSkeleton` x20, `<ErrorState` x24): `InboxPage.tsx:169`, `ReviewsPage.tsx:157`,
  `ViewPage.tsx:27`, `SessionsSection.tsx:69`, `MemberPicker.tsx:14`, `ProjectsPage.tsx:63`,
  `BaselinesPage.tsx:62`, `TriagePage.tsx:180` (detector hits x3, x3, x2, x2).
- Four frames with the same body:
  `settings/Frame.tsx` (51 lines), `integrations/IntegrationFrame.tsx` (68), `instance/AdminFrame.tsx`
  (65), `projects/ProjectSettingsFrame.tsx` (82). `Frame` and `IntegrationFrame` have the **same 18
  lines** (error / loading / read-only Banner / children) and the same prop list
  (`loading, error, onRetry, notFound, readOnlyNote`); `AdminFrame` and `ProjectSettingsFrame`
  repeat the error/skeleton ternary again. Only the breadcrumb, the CSS module and one extra
  state (403 for admin) differ.
- `useLoadingAnnouncement(!data && !error, 'Loading ...')` repeated in 17 pages next to it.
- Pages spell the same props `loading={!data && !error} error={error} onRetry={() => void refetch()}`
  (`WorkspaceGeneralPage.tsx:27`, `WorkspaceStoragePage.tsx:46`, ...).

### Proposal

`apps/web/src/lib/QueryBoundary.tsx` (next to `ErrorState.tsx`, `PageHeading.tsx`):

```tsx
<QueryBoundary query={q} announce="Loading your inbox" notFound="This project doesn't exist">
  {(data) => <InboxList data={data} />}
</QueryBoundary>
// QueryBoundary.Props<T> { query: UseQueryResult<T>; announce?: string; notFound?: string;
//   forbidden?: ReactNode; skeleton?: ReactNode; children: (data: T) => ReactNode }
```

It renders ErrorState (with `onRetry = refetch`), the delayed skeleton, optional forbidden state,
and calls `useLoadingAnnouncement` itself. Then one `PageFrame` in `lib/` taking `crumbs`,
`width`, `readOnlyNote`, `className`, and **the four Frames become 10-line wrappers** that only
compute crumbs (and AdminFrame passes `forbidden`). Replaces 20 ternaries (~6 lines each),
~120 lines of the four Frames, 17 announcement calls. Estimated ~200 lines. Risk: low-medium: the
`Delayed` + skeleton timing and the `role="alert"` of errors are covered by the browser tests
(`apps/web/test/**`). Size M. Needs a design decision: pages that render partial data while
refetching currently decide inline; the render-prop handles `data` only once present, which is
what all 20 do (`!data`).

Not a trap but keep separate: `ProjectSettingsFrame` also loads settings and sets the document
title; keep that inside the wrapper, not in the shared frame.

---

## C4. Providers: seven hand-written HTTP clients, nine copies of JSON narrowing helpers

### Evidence (`packages/providers/src`)

`#call` wrappers, each 25-40 lines, doing: build URL + headers (+ `content-type` when body) +
`JSON.stringify` + `AbortSignal.timeout(15_000)`, read text, `JSON.parse` in try/catch, on `!ok`
extract a message field and throw a typed error with `revoked` rule:

| File | Lines | Differences |
|------|-------|-------------|
| `github.ts:~100-135` | accept + `x-github-api-version`, returns `{status,data}`, message from `message` |
| `gitlab.ts:129-157` | `private-token`, message from `message`/`error`, `revoked = 401` |
| `bitbucket.ts:107-135` | Basic or Bearer, message from `error.message`, `revoked = 401` |
| `figma.ts:114-139` | token header scheme, no timeout, error class `FigmaApiError`, `revoked` 401/403+token |
| `slack.ts:98-120` | form or JSON body, `429` retry-after, `ok:false` in body |
| `linear.ts:50-64` | GraphQL envelope, `trackerError('Linear', ...)` |
| `jira.ts:88-98` | basic/bearer, `trackerError('Jira', ...)` |

The text-then-parse-then-field-message sequence is **character-identical** in github, gitlab and
bitbucket (the detector pairs `gitlab.ts:139` with `cli/src/api.ts:122` too: the CLI repeats the
parse-JSON-safely pattern as well). Errors: `FigmaApiError`, `GithubApiError`, `GitlabApiError`
all extend `ProviderApiError`; `trackerError()` (`tracker-error.ts`) is a fourth constructor.
Narrowing helpers copied: `isRecord` (`slack.ts:19`, `server/lib/github-app.ts:58`), `record`/`str`/`items`
(`figma.ts:75-79`), `asRecord` (`linear.ts:23`, `jira.ts:44`), `record`/`str`
(`integrations/git-support.ts:16-20`), `str` (`worker/jobs/integration-event.ts:31`,
`cli/src/ci-env.ts:285`), `trimSlash` (`jira.ts:42`), `field`/`asId`/`obj`/`text` in
gitlab/bitbucket.

### Proposal

1. **`packages/providers/src/http.ts`**: `createHttpClient(options)` returning
   `request(method, path, { body, headers, form, timeoutMs }) => { status, data, headers }`
   with: base URL, injected `fetch`, default `user-agent: CirCI`, 15s timeout, safe JSON parse,
   one `errorFrom(res, data)` hook per adapter for message and `revoked`:
   ```ts
   export function createHttpClient(opts: { baseUrl: string; fetch?: typeof fetch;
     headers?: (ctx) => Record<string,string>; timeoutMs?: number;
     fail: (status: number, data: unknown, ctx: { method: string; path: string }) => Error }): HttpClient
   ```
   Each adapter keeps only its `fail` mapping and headers. Slack and Linear fit (Slack reads
   `ok` after; Linear unwraps GraphQL after). Saves ~25 lines per adapter x 7 = ~150, minus
   ~60 for the client = **~110 net**.
2. **`@circi/core/src/json.ts`** (pure): `isRecord`, `asRecord`, `str`, `strOrUndefined`, `items`.
   Replaces 9 copies (~35 lines) and gives `integrations`, `worker`, `cli`, `server` one
   definition. `@circi/core` is the correct layer (no I/O). `packages/cli` is published: check
   it already depends on `@circi/core`; if not, leave the CLI copy.

Risk: medium (network behaviour of all hosts). Tests: `packages/providers/test/*` use fakes at the
edge (`fake-tracker-hosts.ts`), so behaviour is covered but only against fakes (say so in the
PR). Size M. Do the helper (2) first: S, no behaviour risk.

---

## C5. Web `api.ts` files: URL builders and refresh-after-mutate

### Evidence

- `` `/api/projects/${seg(workspace)}/${seg(project)}` `` appears 31 times and
  `` `/api/workspaces/${seg(workspace)}` `` 22 times across 17 files. Local `base` helpers are
  re-declared in `settings/api.ts:113`, `triage/api.ts:247`, `builds/discussion-api.ts:6`,
  `builds/issues-api.ts:9`, `integrations/api.ts:54`, `integrations/generic-api.ts:220`,
  `members/api.ts:126,153`.
- Query keys are bare string tuples (`['rules', workspace, project]`, 93 `queryKey: [` sites); only
  `triage/api.ts:21 triageKey` and `account/api.ts:7-8` have a key helper. Cross-feature
  invalidation copies the tuple (`settings/api.ts:115-117` invalidates `['triage', workspace,
  project]` by hand, so a key rename would silently break it).
- 97 `useMutation` and 64 `invalidateQueries`; 102 `onSuccess: refresh | () =>` sites. The shape
  `const refresh = () => Promise.all([invalidate(a), invalidate(b)])` is repeated per feature.
- `lib/http.ts` has `getJson/post/send` already; that part is fine.

### Proposal

`apps/web/src/lib/api-paths.ts`: `projectPath(workspace, project, ...rest)` and
`workspacePath(workspace, ...rest)` returning the `/api/...` string with `seg()` applied, and
`apps/web/src/lib/query-keys.ts` with one function per resource (`keys.rules(ws, project)`,
`keys.triage(ws, project)`, ...) so the key tuple exists once. Optionally
`useInvalidate(...keys)` in `lib/` returning the `refresh` callback. Replaces ~53 URL literals
(shorter, and `seg` can no longer be forgotten), ~93 key tuples, ~25 `refresh` definitions.
Estimated ~150 lines but the main win is correctness of keys. Risk: low; compile errors guide the
migration; `apps/web/test` renders pages with fake fetch and would catch a wrong path. Size S-M.
Per-feature agents can do their own `api.ts` once `lib/` helpers land.

Do **not** build a generic "resource hook factory" over all api.ts files: each has different
optimistic updates and cache surgery (see C7 `settle`).

---

## C6. Integration SDK (packages/integrations): what is left

Evidence: `git-support.ts` and `tracker-support.ts` already hold the shared logic.
Leftover repetition:

- `needsAttention: (err) => (isConnectionRevoked(err) ? REVOKED : null)` in `github.ts:166`,
  `gitlab.ts:148`, `bitbucket.ts:142`; `figma.ts:68` and `slack.ts:107` have a longer variant.
  Add `revokedAttention(message)` to `git-support.ts` (S, ~6 lines).
- `replaceOnReconnect: true` x3 and `events: []` x3: could default for git definitions through a
  `defineGitIntegration()` wrapper; saves ~6 lines. Not worth a new concept.
- `respond()` of GitLab (`gitlab.ts:165-182`) and Bitbucket (`bitbucket.ts:155-181`) both map
  outcome `acted | refused | other` to a user-visible reaction or reply: differ by capability
  (GitLab reacts with an emoji, Bitbucket replies with text). Keep separate (trap T4).
- `LINK_HELP` is defined per host (`github.ts:46`, `gitlab.ts:53`, `bitbucket.ts:36`) with host-specific wording
  ("link GitHub..."): keep.

Net: ~15 lines. Quick win only (C-quick-4).

---

## C7. Web list pages: selection, peek, keyboard, settle

### Evidence

`InboxPage.tsx` (361 lines), `ReviewsPage.tsx` (355), `TriagePage.tsx` (455) each repeat (detector
x2/x3 clusters at `InboxPage.tsx:57` vs `ReviewsPage.tsx:59`, `:193`/`:185`/`:229`):

```
const selectedId = useListStore((s) => s.cursorId); setSelectedId; peek; togglePeek
useEffect(() => () => useListStore.getState().reset(), [])
const [snoozeOpen, setSnoozeOpen] = useState(false)
const selected = items.find(...) ?? items[0]
useListNavigation({ items, getId, selectedId: selected?.id, onSelect })
const settle = (item, message, act) => { const next = nextAfterRemoval(...); act(() => {
  announce(message); setSelectedId(next); if (next) focusRow(listElement.current, next) }) }
useShortcutHandlers({ open: (_a, e) => { if (leavesKeyToFocus(e) || !selected) return false ... },
  peek: ... togglePeek ..., snooze: ... })
<SnoozeMenu open={snoozeOpen} onOpenChange={setSnoozeOpen} onSnooze={...} />
```

`ViewPage.tsx`, `BaselinesPage.tsx` and `BuildsBrowser.tsx` (513 lines) repeat parts.
`lib/use-list-navigation.ts` (156) and `lib/stores/list-store.ts` (42) already exist but the
glue above does not.

### Proposal

`apps/web/src/lib/use-selectable-list.ts`:
`useSelectableList({ items, getId, label })` returns `{ selected, selectedId, select, peek,
togglePeek, listRef, rowProps, listElement, settle(item, message, act), openHandlers }` and
owns the store reset, selection fallback, `settle`, and the standard `open`/`peek` shortcut
handlers (the caller passes `onOpen`). Plus `useSnoozeState()` returning the open flag and
`<SnoozeMenu>` props. Replaces ~40-45 lines x3 = ~130, minus ~60 for the hook: **~100 saved**,
and fixes the drift risk (Reviews `open` checks `selected` separately from `leavesKeyToFocus`,
Inbox does it in one `if`). Risk: medium (keyboard behaviour). Tests: the page browser tests
under `apps/web/test/features/{inbox,reviews,triage}` exercise it. Size M. Order: after C3,
because both touch these three pages.

---

## C8. Types duplicated between `@circi/api` and `packages/db` queries

### Evidence

`contract-check.ts` has 42 `Fits<Json<db>, api>` assertions. Behind each, a hand-written
interface exists on both sides, field for field: `api/review.ts:20-45` vs `db/queries/reviews.ts:37-60`
(`Request` vs `listReviewRequests.Item`: 20 fields, only `Date`/`string` differ),
`api/build.ts:40` vs `db/queries/builds.ts:31`, `api/baseline.ts:7` vs `db/queries/baselines.ts:13`,
`api/notification.ts:23` vs `db/queries/inbox.ts:33`, `api/triage.ts:9` vs `db/queries/triage.ts:34`,
`api/search.ts:13` vs `db/queries/search.ts:35`, `api/storage.ts:4` vs `db/queries/storage.ts:45`,
`api/insights.ts:3` vs `db/queries/insights.ts:44`, `api/project.ts:49` vs `db/repositories/projects.ts:211`.
`packages/api/src` is 1405 lines; roughly a third mirrors a db shape.
Literal unions are also stated twice: `SnoozeKind` (`api/review.ts:4`),
`TriageKind`/`ReviewRuleKind` (`api/triage.ts:4-5`) vs the db enums (`db/src/schema/enums.ts`) and
`core`.

### Proposal (decide, then execute: this is a design change, not a mechanical edit)

Option A (preferred): make the wire type the source of truth with a **time parameter**:
`export interface Request<T = string> { dueAt: T | null; ... }` in `@circi/api`, and let the db
query declare `Review.Request<Date>`. That makes `db -> api` (type-only import) a dependency;
CLAUDE.md says `core` and `api` depend on nothing, so db importing api types is allowed, but
note it changes the picture "dependencies point downwards: apps -> services -> db -> core" by
putting api beside core. Result: delete ~250-500 lines of mirrored interfaces, keep a thin
`contract-check` for the conversion (still useful, now only for `Json<Date>` shape).
Option B: keep both, generate one from the other with a script (adds tooling). Not recommended.
Option C: leave as is; contract-check already catches drift, which is the real risk.

Recommendation: do **not** start with this. First finish C1-C7. Reconsider when a third
consumer (CLI, SDK) needs the same shapes. Size L, risk medium (type-level only, caught by
`pnpm typecheck`).

---

## C9. Worker jobs

### Evidence (`apps/worker/src/runner.ts`)

Five `run*Job` functions (`runJob` for builds `:271-300`, `runWebhookJob :302`, `runGitNotifyJob :326`,
`runEmailJob :349`, `runIntegrationEventJob :371`), each:

```
const fields = {...}
try { const result = await job({...deps subset}, job); await completeJob(db, job.id)
      logger.info({...fields, ...result}, 'x processed') }
catch (err) { const message = err instanceof Error ? err.message : String(err)
              const willRetry = await failJob(db, job, message).catch(() => true)
              logger[willRetry ? 'warn' : 'error']({...fields, attempt: job.attempts, err: message},
                 willRetry ? '... will retry' : '...') }
```

(detector: `:364` and `:406` identical; four copies of the catch). Also the queue-claim chain
(`:262-268`, five `claimJob(db, QUEUE, lockSeconds) ??`) and the `if (job.queue === ...)`
dispatch (`:271-275`) list the same queues in two places and the lanes in a third.

### Proposal

In `apps/worker/src/lib/job-runner.ts`: 

```ts
type JobKind = { queue: string; label: { done: string; retry: string; failed: string };
  fields(job: Job): Record<string, unknown>; run(job: Job): Promise<Record<string, unknown>> }
async function runKind(deps, kind: JobKind, job: Job): Promise<void>   // the try/complete/catch/fail once
const kinds: JobKind[] = [processBuildKind(deps), webhookKind(deps), ...]
// claim order = kinds order; dispatch = kinds.find(k => k.queue === job.queue)
```

`process-build` keeps one special case (its final failure also calls `failBuild`): give `JobKind`
an optional `onGiveUp(job, message)`. Saves ~80 lines (5 x 22 - ~30) and removes the 3-way queue
list. Risk: low-medium; `apps/worker/test/**` (runner, process-build) cover retry/give-up.
Size S.

---

## C10. Repositories, queries, services

### Evidence

- **NotFound after update/delete**: 24 `throw new NotFoundError('X not found')` in repositories and
  16 in services, usually `if (rows.length === 0) throw ...` after `.returning()`
  (`views.ts:156,218`, `webhooks.ts:64`, `domains.ts:71`, `ignore-regions.ts:143`,
  `review-rules.ts:168,189`) or `if (!row) throw ...` after a select (`projects.ts:80,112,292,303`).
  Add `packages/db/src/errors.ts`: `export function orNotFound<T>(row: T | undefined, what: string): T`
  and `firstOrNotFound(rows, what)`. ~30 lines of 2-line blocks to 1 line: ~35 saved. Size S.
  Messages are asserted in route tests ("Project not found"), so keep them verbatim.
- **Service pass-throughs**: `services/src/views.ts` is 85 lines of
  `return db.transaction((tx) => repo(tx, input))` (9 functions); `triage.ts:26,57,94,99`,
  `projects.ts:9` the same. CLAUDE.md says repositories are called directly for "plain reads and
  simple writes that trigger nothing", and these trigger nothing. A transaction around one
  statement adds nothing. Either delete the wrappers and have the routes call the repositories
  (`views.ts` ~85 lines, triage/projects ~30), or keep them *because* a future notice is expected;
  that is a decision for the owner. Check each repo function is single-statement (`updateSavedView`,
  `reorderSavedViews` may be several: keep a transaction inside the repository then). Size S,
  risk low. Also fixes `layers.test.ts` intent.
- **Notice triple**: `queueWebhookEvent` + `queueIntegrationEvent` + `queueGitNotify` after a
  build change: `builds.ts:137-139`, `reviews.ts:62-73`, `:232`, `:362`. A
  `queueBuildChanged(tx, build, { webhook?, integration? })` helper in `services/src/` would cut ~12
  lines and ensure no caller forgets one. Only 2 calls have all three: marginal (S, optional).
- **Build + project load in a service**: `reviews.ts:97-100`, `issues.ts:28-30`, `reviews.ts:33`,
  `git-links.ts:46`, `gate.ts:22`: `getBuild`, `getProjectById`, `throw NotFoundError('Build not found')`.
  `loadBuildWithProject(tx, id)` in `services/src/lib.ts`: ~20 lines saved (S).
- **Joins**: `innerJoin(projects, eq(projects.id, builds.projectId))` appears 15 times in
  `db/src` (search, inbox, instance-admin, workspace-builds x3, files, ignore-regions, reviews,
  comments, notifications, integration-events, triage, review-requests). `eq(projects.workspaceId, id)`
  13 times. Drizzle builders are heavily generic: a shared `buildsInWorkspace(db, workspaceId)`
  helper returning a partial query is awkward to type. Recommend only the *predicate* helpers:
  `inWorkspace = (id) => eq(projects.workspaceId, id)` (already local in `queries/search.ts:104`)
  and `buildProjectJoin = eq(projects.id, builds.projectId)` as exported constants in `db/src/queries/lib.ts`.
  ~0 lines saved, removes the chance of a wrong join column. Optional (S).
- **Ordering tie-breaks**: 60 `orderBy` sites; the `(createdAt desc, id desc)` /
  `(name asc, slug asc)` pairs are repeated 13 times (`asc(projects.name), asc(projects.slug)` x3,
  `desc(createdAt), desc(id)` x5). Constants like `byNewest(table)` save nothing and hide the
  order from the reader; skip (trap T2).
- **Row to wire mappers** in queries/repositories: 37 `Date | null` conversions in server+db
  (`?.toISOString() ?? null`); handled by `isoOrNull` in C1 for the server side. DB-side
  `presentRotation`, `describeBuild` (`http/lib/presenters.ts:5`) and
  `repositories/webhooks.ts:136` build the same `{ id, number, name, status, conclusion,
  reviewStatus }` build summary: reuse one `buildSummary(build)` from `@circi/core`-agnostic
  location (`packages/db/src/queries/lib.ts`) (~15 lines, S).

---

## C11. Web dialogs, forms and small shared pieces

- **SecretBox x2 + OnceSecret**: `features/projects/SecretBox.tsx` (22 lines) and an identical
  exported `SecretBox` in `features/projects/CreateDialogs.tsx:14-31` (used by `NewProjectDialog.tsx:7`);
  `features/instance/OnceSecret.tsx` (52 lines) re-implements copy state on a button.
  Clipboard writes appear 3 times (`ShortcutLayer.tsx:42`, `NewProjectDialog.tsx:185`,
  `instance/admin-api.ts:237`). `@circi/ui` already has `Ref` (copyable value). Move one
  `SecretBox` into `@circi/ui` (it is 10 lines over `Ref` + `Text`), delete the second, add
  `useCopy(text) -> { copy, state: 'idle'|'copied'|'failed' }` in `@circi/ui` or `lib/` and use it
  in `OnceSecret` and the snippet copy. ~60 lines saved, S.
- **Confirmed-input dialogs**: `builds/RejectDialog.tsx` (103) and `projects/BulkRejectDialog.tsx` (94)
  differ only in title, description, error text and one `aria-describedby`; the detector found the
  `trimmed/touched/invalid/submit` block x2. Combine as `ReasonDialog` (props `title`, `description`,
  `confirmLabel`, `invalidMessage`, `pending`, `onSubmit(reason)`) in `features/builds/`.
  ~70 lines saved. `RequestReviewDialog`, `CreateIssueDialog`, `SaveViewDialog`,
  `AddIntegrationDialog`, `NewProjectDialog` (1042 lines across 9 dialog files) share a skeleton
  (`useId`, `form id`, `Dialog actions={Cancel, Submit form=…}`, reset on close): extract a
  `FormDialog` wrapper in `@circi/ui` (`<FormDialog title open onClose onSubmit pending submitLabel>`)
  that does the `form={id}` wiring. ~10-12 lines per dialog x 8 = ~90 lines. Medium size
  (touches 8 files + ui), but a new ui component needs a visual test.
  29 files import `FormEvent`: the `submit(e) { e.preventDefault(); ... }` pattern is
  everywhere; a `useFormSubmit` is not worth it (just move `preventDefault` into `FormDialog`).
- **Dirty/saving/error for forms**: `ruleDirty`, `rotationDirty`, `targetDirty`, `flaky-setting`,
  `settings-patch.ts`, `delete-project.ts` follow the same "saved vs draft -> patch only what
  changed" idea (`appearance.ts appearancePatch`). They are small, typed pure functions that
  are individually tested; a generic `diffPatch(saved, draft)` would work for flat objects only
  and remove ~25 lines. Skip (trap T3).
- **Role/`canManage`**: 84 uses; `canManage` is a field the server already sends. No dedup needed
  beyond C1's server helper.

---

## C12. Constants and enums duplicated across packages

- **Project icon list**: `PROJECT_ICON_NAMES` (about 40 names, `core/src/project-appearance.ts`) and a second list
  with a `Record<name, LucideIcon>` in `ui/src/project-icons.ts`; `PROJECT_COLORS` also defined in
  both (`core/project-appearance.ts:9`, `ui/project-icons.ts:74`). The comment says it is mirrored and
  `apps/web/test/lib/project-appearance.test.ts` checks equality. This is deliberate: `@circi/ui`
  has no dependency on core. If you want one list: make ui define
  `const PROJECT_ICONS = { 'layout-grid': LayoutGrid, ... } as const` and derive the names from
  `Object.keys`, and have core import nothing (server only needs to *validate* names: it could
  take the list from ui at the app boundary, but ui is a browser package: do not). Keep both and the test (trap T5).
- **Webhook events**: `core/src/events.ts`, `db/schema/webhooks.ts`/`enums.ts`, `api/project.ts`,
  `web/projects/webhook-events.ts` (descriptions only, keyed by string): one real source (core), others
  derive. No action.
- **Status/conclusion literals** (`'approved'`, `'rejected'`, `'no_changes'`, `'action_required'`)
  appear in 20 files, mostly checks in services and web; they come from db enums
  (`schema/enums.ts`) and `core/outcome.ts`. `StatusChip.module.css` keys CSS on the same
  strings (unavoidable). No action.
- `SnoozeKind`, `TriageKind`, `ReviewRuleKind` declared in `api` and as db enums: part of C8.

---

## C13. Tests (brief; another agent audits tests)

Test code is 51.7k lines of 122k total. Largest: `Shell.browser.test.tsx` 763,
`e2e/sites.e2e.test.ts` 675, `BuildPage.browser.test.tsx` 588. `signIn` helpers exist 3 times:
`apps/server/test/support/helpers.ts:68` (shared), `e2e/src/admin.ts:108`,
`e2e/src/people.ts:180`; plus local one-offs in `client-address.test.ts:41`,
`email-login.test.ts:58,222`, `instance-admin.test.ts:102`. The server one-offs may use the shared
helper. `e2e/src/people.ts:114,201` repeats the same `fetch(.../email-otp/send-verification-otp...)`
call. Not pursued further.

## C14. Config and scripts (quick, low value)

- `onLog(level, log, handler) { handler(log.code === 'UNRESOLVED_IMPORT' ? 'error' : level, log) }`
  is copied in `apps/server/tsdown.config.ts`, `packages/cli/tsdown.config.ts`,
  `packages/vitest/tsdown.config.ts`; `publint/attw/dts/sourcemap` options repeat in the latter two.
  A root `tsdown.shared.ts` with `strictResolve` and `publishedPackage` saves ~15 lines; it adds
  an import across package boundaries for the published packages (their configs are not
  published, fine). S, optional.
- `package.json` scripts are minimal (`build`, `dev`, `start`, `typecheck` in one app). `dev`
  `node --conditions=@circi/source src/main.ts` repeats in server and cli: leave.
- tsconfigs: root, `web`, `ui`, `ui/previews`, `cli`, `vitest` only. Fine.

---

## Over-abstraction traps (looks similar, keep separate)

- **T1. The two cursors** (`beforeNumber` vs `(createdAt,id)` row-compare plus cursor row lookup).
  Different keys and one validates cursor ownership. A generic `paginate()` would need both
  strategies as parameters and gives nothing. Leave.
- **T2. orderBy tie-break constants.** Hiding `desc(createdAt), desc(id)` behind a name makes the
  query harder to read; they are the stable-order contract per query.
- **T3. Dirty/patch/problem functions in web `api.ts`** (`ruleDirty`, `targetProblem`,
  `rotationDirty`): small, pure, tested, domain-specific wording.
- **T4. Git host adapters' `verifyWebhook` and `respond`**: GitHub HMAC `sha256=`, Bitbucket HMAC
  `X-Hub-Signature`, GitLab shared token. Same shape, different security semantics; sharing code
  here risks a verification bug. Only the `timingSafeEqual` helper in `providers` is shareable
  (github.ts:58-66 vs bitbucket.ts:54-62 differ in the header prefix only): fine as a
  4-line `verifyHmac(secret, body, header, prefix)` but not a framework.
- **T5. Mirrored icon/colour lists** between `@circi/core` and `@circi/ui`, with an equality test.
  Keeping `@circi/ui` independent matters more than 40 lines.
- **T6. `contract-check.ts`** is a guard that makes duplication of types safe; do not delete it
  before C8 is actually done.
- **T7. `ProjectSettingsFrame` vs the other Frames**: it fetches and manages titles; keep as a
  wrapper around the shared frame rather than forcing the shared one to fetch.
- **T8. `integrations-generic.ts` (723 lines)** is long because it is the one generic CRUD +
  mapping + links route set for all definitions; splitting it by concern is fine, merging it with
  `integrations.ts` is not.
- **T9. `loadProject` for `/v1` token routes**: they authenticate by CI token, not session; do not
  push them through the session loaders.
- **T10. Instance admin guard** is already a hook (`hooks/instance-admin.ts`); do not add another.

## Quick wins (each under one hour, no design decision)

1. `@circi/core/src/roles.ts` `canManage(role)`; replace 16 server uses. (~25 lines)
2. `core/src/json.ts` helpers; replace the 9 copies in providers, integrations, server, worker.
3. Delete the second `SecretBox` in `projects/CreateDialogs.tsx` and import `./SecretBox.tsx`
   (then `NewProjectDialog.tsx:7`). (~20 lines)
4. `revokedAttention(message)` in `integrations/git-support.ts` for the 3 git definitions.
5. `orNotFound`/`firstOrNotFound` in `db/src/errors.ts`; migrate repositories file by file.
6. `iso()`/`isoOrNull()` in `server/http/lib/presenters.ts`; replace in 8 route files.
7. `packages/ui` `VisuallyHidden` + one `.srOnly`; replace the 6 variants.
8. `projectParams`/`workspaceParams`/`buildParams` exported once from `lib/*-access.ts`; delete 25
   copies (mechanical, compile-checked).
9. `ConfirmDialog` reuses `Dialog.module.css` backdrop/viewport (~30 CSS lines).
10. Remove the pass-through wrappers in `services/src/views.ts` after confirming single-statement
    repositories (decision first).

## Prioritised plan (parallel Sonnet agents with disjoint files)

Gate: every step ends with `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
tests green before and after (behaviour-preserving). Commit per step.

**Wave 0 (one agent, ~1 h, unblocks the rest)**: `packages/core` only. Add `roles.ts`
(`canManage`) and `json.ts` (`isRecord`, `asRecord`, `str`, `items`) and export them. No call
sites yet.

**Wave 1 (parallel; file sets are disjoint)**

- **A. Server routes (C1)**: `apps/server/src/http/**` only. Rewrite `loadProject`/`loadWorkspace`
  to throw, add `loadBuild`, export params schemas, migrate all `routes/dashboard/*.ts`, add
  `iso`/`isoOrNull`. Do not touch `routes/v1`, `routes/argos`, `hooks/`. Tests in
  `apps/server/test/http/**` must pass unchanged (message strings preserved). ~350 lines.
- **B. Providers and integrations (C4, C6)**: `packages/providers/src`, `packages/integrations/src`,
  `packages/providers/test` only for new `http.ts` tests. Uses Wave 0's `json.ts`.
  Fakes-at-the-edge only: note that in the commit. ~150 lines.
- **C. Worker (C9)**: `apps/worker/src` only. ~80 lines.
- **D. DB and services (C10)**: `packages/db/src/errors.ts` + repositories, `packages/services/src`
  (`orNotFound`, wrapper decision for `views/triage/projects`, `loadBuildWithProject`,
  `queueBuildChanged`). Must not edit `apps/server`. If wrappers are removed, coordinate with A:
  do that part after A merges (one-line import changes in routes). ~120 lines.
- **E. Web data layer (C5)**: `apps/web/src/lib/{api-paths,query-keys}.ts` and every
  `apps/web/src/features/*/api.ts`, `*-api.ts` (not `.tsx`). ~150 lines.

**Wave 2 (after wave 1; web and ui, ordered because `.tsx` and `.css` share class names)**

- **F. Web page scaffolding (C3, C7)**: `QueryBoundary`, `PageFrame`, the four Frames, the 20
  ternaries, `use-selectable-list` and its three pages. Files: `apps/web/src/lib/*`,
  `apps/web/src/features/**/*.tsx` except dialogs. Must run after E (imports of `api.ts`
  stay stable). ~300 lines.
- **G. Dialogs and secrets (C11)**: `SecretBox` into `packages/ui`, `useCopy`, `ReasonDialog`,
  `FormDialog` + the 8 dialog files, `OnceSecret`. Files: `packages/ui/src/{SecretBox,FormDialog}*`,
  `apps/web/src/features/{builds,projects,instance,integrations,views}/*Dialog*.tsx`,
  `OnceSecret.tsx`, `ShortcutLayer.tsx`. Disjoint from F if F skips dialog files. ~220 lines.

**Wave 3 (after F and G; CSS follows the tsx)**

- **H. CSS (C2)**: `packages/ui/src/*.css` (VisuallyHidden, Dialog/ConfirmDialog sharing,
  focus-ring if the rules prove identical), `apps/web/src/lib/settings-ui` and the four settings
  stylesheets, `<Stack>` adoption per feature dir. Run `pnpm test` (browser and the ui visual
  project) and review changed screenshots. ~450 CSS lines. Do not split the radius question
  (8 vs 10px) between agents: decide first.

**Not now**: C8 (api/db type unification, needs an owner decision on the db -> api edge),
C14 (tsdown shared), route-registration loop, join-predicate constants.

Total realistic reduction across waves 0-3: roughly 1,800-2,000 lines (of ~55k non-test TS/CSS,
about 3.5%), with the bigger payoff being one place for access control, one HTTP client for
providers, one page-state component and one settings style vocabulary.
