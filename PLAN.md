# Zopheros — Self-hosted Visual Regression Testing

A cheaper, self-hostable alternative to Argos-CI. CI uploads screenshots → server diffs them against a baseline → results show up as a GitHub check, and a reviewer approves or rejects the changes in a web UI.

---

## 1. What Argos does (scope we're replicating)

| Capability                                                                                        | Argos                               | Zopheros v1                                                                        | Later                     |
| ------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| Upload screenshots from CI (CLI)                                                                  | ✅                                  | ✅                                                                                 |                           |
| Test-runner SDKs (Playwright, Cypress, Storybook, Vitest)                                         | ✅                                  | ✅ Playwright + **Vitest browser mode** (native, §7.7); others via Argos SDKs (§3) | Native Cypress, Storybook |
| Content-addressed dedup of images                                                                 | ✅                                  | ✅                                                                                 |                           |
| Baseline selection (merge-base on base branch)                                                    | ✅                                  | ✅                                                                                 |                           |
| Pixel diffing + diff image                                                                        | ✅                                  | ✅                                                                                 |                           |
| Parallel/sharded CI builds merged into one                                                        | ✅                                  | ✅                                                                                 |                           |
| Commit status + PR/MR comment                                                                     | ✅ (GitHub, GitLab)                 | ✅ GitHub, GitLab, Bitbucket, Gitea/Forgejo + generic (CLI exit code / webhook)    | Azure DevOps              |
| Organizations, members, roles                                                                     | ✅                                  | ✅                                                                                 | SSO/SAML                  |
| Review UI: side-by-side, overlay, slider; approve/reject                                          | ✅                                  | ✅                                                                                 | Per-screenshot comments   |
| Auto-approve builds on default branch → new baseline                                              | ✅                                  | ✅                                                                                 |                           |
| Thresholds, ignore regions                                                                        | ✅                                  | Threshold ✅                                                                       | Ignore regions, masks     |
| Flaky screenshot detection                                                                        | ✅                                  | ❌                                                                                 | ✅                        |
| Playwright trace / test metadata links                                                            | ✅                                  | Store metadata only                                                                | Trace viewer link         |
| **Hosted static sites per build**: Storybook, Vitest/Playwright reports, coverage, docs, anything | ❌ (Chromatic hosts Storybook only) | ✅ optional, per project, one pipeline for all kinds                               | More built-in kinds       |
| Billing                                                                                           | ✅                                  | ❌                                                                                 | ❌                        |

**Explicitly out of scope:** billing, usage metering, hosted browsers (we never render pages; CI does).

**Decisions made**
1. **Argos API compatibility in v1:** yes (§3).
2. **Git hosting:** works with any host. The core never calls a git host's API to work out baselines (§7.2); host integrations are optional adapters (§7.4).
3. **Multi-tenant:** organizations, members and roles (§6, §8).
4. **Storage:** local disk by default (cheapest), S3-compatible as an option (§2).
5. **Merge blocking:** unreviewed changes block merging by default, configurable per project (§7.4).
6. **Static-site hosting:** the dashboard is at **`zop.example.com`**. Hosted sites live on a **separate, dedicated domain** (placeholder `example-sites.com`), one subdomain per site: `<site-id>.example-sites.com`. Uploaded code then can't set cookies on `example.com` or `zop.example.com`. DNS for both is on **Route53**, which is the default Caddy DNS module (§7.6).
7. **One static-site pipeline** for every kind of site (Storybook, Vitest report, Playwright report, coverage, docs, generic). Kinds are small plugins on a shared upload, ingest, serve, alias and link flow (§7.6).
8. **Vitest:** first-class SDK for Vitest browser mode, including Storybook's Vitest addon. Vitest HTML reports are hosted through the same pipeline (§7.7).
9. **Hosted sites always require login.** There are no public sites. Logging in once at `zop.example.com` works for every site (SSO through a token handoff) (§7.6).
10. **Site navigation:** opening a commit/PR/branch's sites starts at a menu of all its hosted sites. A small switcher stays available inside each site. With only one site there's no menu or switcher; you go straight to the site (§7.6).
11. **Email login (magic link / one-time code)** acts as SSO for the dashboard and all sites. It can be turned off for the whole instance or per organization (§7.8).
12. **Domain rules, written as a warning step in the setup guide (§7.6):** the sites domain is used for nothing but Zopheros sites. Nothing on `example.com` may set cookies for the whole domain.
13. **Baseline history for Argos-SDK users:** use the SDK's history when it sends it, then the git host's API, then the fallback baseline. A `zopheros argos-env` wrapper is documented for exact baselines on any host. The build page shows which source was used (§7.2).
14. **Merge gate:** when a git host integration is connected, Zopheros's own commit status is the required check, and approving flips it green with no CI re-run. Plus a **GitHub bot** (a GitHub App, like Argos's) for checks, PR comments, and approving from GitHub (§7.4).
15. **Signups:** invite-only by default, a first-run setup link for the instance admin, email-domain auto-join for verified domains, and only the instance admin can create orgs. Both can be opened up with env flags (§8).

---

## 2. Architecture

```
 CI job ── zopheros CLI / Playwright reporter
   │  1. POST /builds (sha256 list) → presigned PUT URLs for missing files only
   │  2. PUT images directly to object storage
   │  3. POST /builds/:id/finalize (names + metadata, shard i of n)
   ▼
 ┌──────────────┐      ┌───────────────┐      ┌──────────────────┐
 │  API server  │◀────▶│   Postgres    │◀────▶│   Diff worker    │
 │ (+ web UI)   │      │ (data + queue)│      │ sharp + odiff    │
 └──────┬───────┘      └───────────────┘      └────────┬─────────┘
        │                                              │
        ▼                                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Object storage: S3 / R2 / MinIO / local filesystem          │
 └─────────────────────────────────────────────────────────────┘
        │
        ▼
 Git provider adapters (optional): GitHub · GitLab · Bitbucket · Gitea/Forgejo
   → commit status + PR/MR comment.  No adapter? → CLI `--wait` exit code / outgoing webhook
```

**Storage: local disk vs. object storage.** "Local disk" means a directory on the server running Zopheros (a Docker volume such as `/var/lib/zopheros/files`), **not the git repo**. Committing screenshots to the repo would bloat its history permanently; we never do that.

| Option                                | Approx. cost                                              | Notes                                                                                            |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Local disk (default)**              | Included in the VM; extra block storage ~$0.05–0.10/GB-mo | Cheapest at small/medium scale; no request or egress fees. Single-node only; you handle backups. |
| Cloudflare R2                         | ~$0.015/GB-mo, **no egress fees**                         | Best if you need multiple app nodes or off-box durability.                                       |
| Backblaze B2 / Hetzner Object Storage | ~$0.006–0.01/GB-mo                                        | Cheapest object storage; free egress has some limits.                                            |
| AWS S3                                | ~$0.023/GB-mo + egress                                    | Most expensive here; only if already on AWS.                                                     |

With content-addressed dedup and retention, a typical project stays in the low tens of GB, so local disk is the default. The storage driver interface makes switching a config change, plus a `zopheros storage migrate` command to copy files across.

**Cost-driven design choices**
- **No Redis.** The job queue lives in Postgres (`pg-boss` or `graphile-worker`). One fewer service to run.
- **One Docker image.** `zopheros serve` (API + UI), `zopheros worker`, or `zopheros all` for small installs. A single small VM can run it.
- **Content-addressed storage.** Files are keyed by SHA-256; unchanged screenshots across builds are uploaded and stored once. This is the biggest storage saving.
- **Skip work on identical hashes.** Same hash as baseline → `unchanged`, no pixel diff. Most screenshots in most builds go this way.
- **Direct-to-storage uploads** through presigned URLs, so the API never proxies image bytes (with a streaming fallback for the local-filesystem backend). Every upload is **checksum-verified before it can be deduplicated against** (§8).
- **Retention job.** Mark-and-sweep with a grace period and upload claims, so it never deletes a file that an in-flight build relies on (§8). Baselines are never deleted.

---

## 3. Key decision: Argos API compatibility

Argos's JS SDKs (`@argos-ci/cli`, `@argos-ci/playwright`, `@argos-ci/cypress`, `@argos-ci/storybook`) are open source and accept a custom API base URL (`ARGOS_API_BASE_URL` / `apiBaseUrl`). If Zopheros implements the same upload endpoints, **existing Argos users switch by changing one env var** and we don't have to write or maintain SDKs.

- **Recommended:** v1 implements the Argos upload API contract (to be confirmed from the `argos-ci/argos-javascript` source — endpoint shapes, auth header, sharding fields) **and** ships a thin native CLI on the same endpoints.
- Risk: their contract can change. Mitigation: pin a tested SDK version range in docs and add a contract test suite running the real Argos CLI against our server in CI.
- **Commit history from Argos SDKs:** first task in M3 is to check in the SDK source which fields the SDK sends (expected: a merge-base SHA and a list of parent commits). The compat layer maps them to `merge_base_sha` / `ancestor_shas` when present. When they aren't, §7.2's fallback order applies.
- Check license terms of the SDKs before depending on them (MIT expected).

---

## 4. Tech stack (recommended)

| Layer         | Choice                                                                                                                                                                                    | Why                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Language | TypeScript 7 on Node 26 (LTS, pinned in `.nvmrc` for nvm), pnpm 12 monorepo. Oxc tooling: oxlint (with type-aware rules via oxlint-tsgolint) and oxfmt | Same language as the SDK ecosystem (Playwright/Cypress); Oxc tools are fast native binaries |
| API           | Fastify (or Hono) + zod                                                                                                                                                                   | Fast, typed schemas, OpenAPI generation                 |
| DB / ORM | Postgres 18 (16+ supported) + Drizzle (SQL migrations generated by drizzle-kit, applied at startup under an advisory lock) | Also hosts the queue |
| Queue         | pg-boss                                                                                                                                                                                   | Postgres-backed, retries, concurrency                   |
| Image diff    | `odiff` (native, fast, anti-aliasing aware), `pixelmatch` fallback; `sharp` for decode/resize/thumbnails                                                                                  |                                                         |
| Storage       | Driver interface: **local FS (default)** + S3-compatible (R2/B2/MinIO/AWS)                                                                                                                | Cheapest default, easy upgrade path                     |
| Web UI        | React + Vite + TanStack Query/Router, served by the API                                                                                                                                   |                                                         |
| Auth          | Pluggable login methods, each can be turned off: **email login (magic link + 6-digit code)**, password (argon2), OAuth/OIDC (GitHub, GitLab, Google, any OIDC); per-project tokens for CI | Can't depend on any single git host for identity (§7.8) |
| Git providers | Adapter interface: GitHub App, GitLab, Bitbucket, Gitea/Forgejo                                                                                                                           | Status + comments only; baselines never depend on them  |
| Email         | SMTP (Nodemailer)                                                                                                                                                                         | Invites, magic links                                    |
| Deploy | Docker image (`deploy/Dockerfile`), `deploy/docker-compose.yml` (app + Postgres, local-disk volume), `docker-compose.s3.yml` overlay (MinIO, dev only), Helm chart later | |

---

## 5. Repo layout

```
zopheros/
  apps/
    server/        # Fastify API, GitHub webhooks, serves built UI
    worker/        # diff + notification jobs
    web/           # React review UI
  packages/
    core/          # domain logic: baseline resolution, build state machine
    db/            # Drizzle schema + migrations
    storage/       # S3 + FS drivers
    sites/         # static-site ingest (tarball extract, manifest) + serving handler
    diff/          # odiff/pixelmatch wrapper, thumbnails
    providers/     # GitProvider interface + github/, gitlab/, bitbucket/, gitea/ adapters
    auth/          # sessions, password/OIDC, org RBAC
    cli/           # `zopheros upload ./screenshots`
    sdk-core/      # shared: screenshot stabilization, metadata, upload client
    playwright/    # reporter/fixture (only if not relying on Argos SDK)
    vitest/        # Vitest browser-mode helper + reporter + Storybook-addon integration
  deploy/
    docker-compose.yml
    Dockerfile
  docs/
```

---

## 6. Data model (v1)

- **users**: id, email (unique), name, avatar_url, password_hash (nullable), email_verified_at
- **identities**: user_id, provider (`github` | `gitlab` | `google` | `oidc:<id>`), subject: linked OAuth/OIDC logins. Unique on (provider, subject), so identities are matched by issuer + subject and never by email alone (§7.8)
- **oidc_providers**: id, scope (`instance` | `org`), org_id (nullable), issuer, client_id, client_secret (encrypted), trusted_for_email (bool, instance-scoped only)
- **organizations**: id, name, slug, created_at, auth_settings (jsonb: `email_login_enabled`, `password_login_enabled`, `oidc_providers[]`, `allowed_email_domains[]`, `auto_join_role`)
- **login_challenges**: id, email, code_hash, link_token_hash, attempts, expires_at, consumed_at, ip, user_agent (email login, §7.8)
- **sessions**: id (hashed), user_id, created_at, last_seen_at, expires_at, ip, user_agent (list and revoke in the UI)
- **memberships**: org_id, user_id, role (`owner` | `admin` | `member` | `viewer`)
- **invites**: org_id, email, role, token_hash, expires_at
- **provider_connections**: id, org_id, kind (`github` | `gitlab` | `bitbucket` | `gitea`), base_url (self-hosted GitLab/Gitea), credentials (encrypted), metadata
- **projects**: id, org_id, name, slug (unique per org), token_hash (CI token scopes: create builds/sites + read status of this project's builds, §8), default_branch, provider_connection_id (nullable), repo_ref (e.g. `owner/name` or GitLab project id), diff_threshold, auto_approve_default_branch (bool), **block_merge_on_changes (bool, default true)**, retention_days
- **files**: sha256 (PK), storage_key (`<sha256>/<generation-uuid>`, so a new upload of a just-deleted hash never collides with the old object's deletion), width, height, bytes, kind (`screenshot` | `diff` | `thumbnail` | `asset`), status (`pending` | `verified`), verified_at, gc_marked_at (nullable), created_at. **Dedup only matches `verified` rows.**
- **upload_claims**: build_id or site_id, file_sha256, created_at. Records "the server told this upload it already has the file". GC treats claims as references; they're removed on finalize or when the upload expires (24 h).
- **builds**: id, project_id, number (per-project sequence), name (default `"default"`; allows several build types per commit), commit_sha, branch, pr_number, base_branch, merge_base_sha, ancestor_shas (text[]; sent by the CLI), ancestry_status (`ok` | `missing` | `truncated`), baseline_source (`cli` | `sdk` | `provider` | `fallback` | `none`), base_build_id (nullable), status (`pending` → `uploading` → `processing` → `complete` | `error` | `expired`), parallel_nonce (nullable), parallel_total, conclusion (`no_changes` | `changes_detected`), review_status (`pending` | `approved` | `rejected`), created_at. **Unique on (project_id, name, commit_sha, parallel_nonce)** where the nonce is set, so shards that start at the same moment get the same build.
- **build_shards**: build_id, shard_index, finalized_at. PK (build_id, shard_index). The build is complete when the number of distinct shards equals `parallel_total`; a retried shard upserts its own row instead of being counted twice.
- **screenshots**: id, build_id, shard_index, name, file_sha256, metadata (jsonb: browser, viewport, test title/file, retries, url, storyId)
- **screenshot_diffs**: id, build_id, base_screenshot_id (nullable), head_screenshot_id (nullable), status (`added` | `removed` | `changed` | `unchanged` | `failed`), score (0–1), diff_file_sha256, job_status
- **reviews**: id, build_id, user_id, state (`approved` | `rejected`), source (`ui` | `github-check` | `github-comment` | `auto`), created_at (history, latest wins)
- **commit_ancestry**: project_id, commit_sha, merge_base_sha, ancestor_shas, created_at. Registered by `zopheros argos-env` and used when an Argos SDK build for that commit arrives (§7.2)
- **instance_settings**: setup_token_hash (one-time, cleared after first admin is created), signups_enabled, org_creation (`admin` | `anyone`)

- **static_sites**: id, project_id, build_id (nullable; a site can be uploaded alone), kind (`storybook` | `vitest-report` | `playwright-report` | `coverage` | `docs` | `generic`), name (slug, default = kind; lets you have several sites per commit, e.g. `docs` and `storybook`, or `storybook-web` and `storybook-mobile`), entry_path, spa_fallback (bool), commit_sha, branch, pr_number, status (`uploading` | `ready` | `error` | `expired`), total_bytes, file_count, created_at
- **static_site_files**: site_id, path, file_sha256, content_type (PK site_id + path). The blobs live in `files` (kind `asset`) and are deduplicated across sites, like screenshots.
- **static_site_aliases**: project_id, site_name, alias (`branch/<name>`, `pr/<n>`, `latest`), site_id. Unique on (project_id, site_name, alias). Gives stable URLs that move to the newest site.
- projects gain: `static_hosting_enabled` (bool, default false). There is no public flag; sites always require login.

Indexes: (project_id, branch, created_at), (project_id, name, commit_sha), (build_id, name) unique on screenshots, (file_sha256) on screenshots, static_site_files and upload_claims (for GC reference checks).

---

## 7. Core flows

### 7.1 Upload (from CI)

1. CLI collects `*.png` from a directory (+ optional sidecar JSON metadata), computes SHA-256 per file.
2. Reads CI context from env: commit SHA, branch, PR/MR number, base branch. Detectors for GitHub Actions, GitLab CI, Bitbucket Pipelines, Gitea/Forgejo Actions, CircleCI, Jenkins, Buildkite, Azure Pipelines, plus generic `ZOPHEROS_*` overrides for anything else. **Gotcha:** on GitHub `pull_request` events `GITHUB_SHA` is the merge commit; use the PR head SHA from the event payload.
3. **Collects git ancestry locally.** This is what keeps baselines independent of any git host. It always works from the **head SHA from step 2**, never from `HEAD`, because CI checkouts often sit on a synthetic merge commit (GitHub `refs/pull/N/merge`). Working from that commit would make the merge-base the tip of the base branch, not the PR's fork point.
   1. Make sure both commits exist locally: `git fetch --no-tags --depth=200 origin <headSha> +refs/heads/<base>:refs/remotes/origin/<base>`. Default CI checkouts (e.g. `actions/checkout` with depth 1) don't have the base branch at all, and `git fetch --deepen` only deepens refs that are already there.
   2. `git merge-base <headSha> origin/<base>`. If it fails because history is shallow, deepen both refs (`git fetch --deepen=200 origin <headSha> <base>`) up to a limit (default 2,000 commits) and retry.
   3. `git rev-list --first-parent -n 200 <merge-base>` → `ancestor_shas`.
   4. If it still can't find a merge-base, it sends `ancestry_status: missing`. The server then uses the provider adapter's `getMergeBase` if one is connected, otherwise the fallback (§7.2), and the build page shows a warning with a fix (`fetch-depth: 0`, or allow the CLI to fetch).
   - Default-branch builds: the same steps with `<base>` = the default branch. The merge-base is the head itself, so `ancestor_shas` starts at HEAD~1.
4. `POST /v1/builds` with project token, commit info, ancestry, hashes, and optional `parallel: {nonce, total, index}`.
   - The server uses `INSERT … ON CONFLICT (project_id, name, commit_sha, parallel_nonce) DO NOTHING` and then selects the row, so shards that arrive at the same moment all join the same build.
   - It returns the build id, plus presigned URLs for every hash that has no **verified** `files` row. For hashes it already has, it records `upload_claims` in the same transaction (§8), so GC can't delete them before finalize.
5. CLI uploads in parallel (bounded concurrency, retries). Each presigned PUT carries the expected SHA-256 checksum, so storage rejects bytes that don't match (§8).
6. `POST /v1/builds/:id/finalize` with `{shard_index, screenshots: [{name, sha256, metadata}]}`.
   - The server checks that every referenced hash is verified (missing → 409 with the list, and the CLI re-uploads).
   - It upserts `build_shards(build_id, shard_index)` and replaces that shard's screenshots, so a retried shard is idempotent and never counted twice.
   - The build moves to `processing` once `count(distinct shard_index) == parallel_total`. A timeout (default 30 min since the first shard) marks it `error` and lists the missing shard indexes. Finalize after `processing` → 409.
   - Shard index sources: `--shard-index`, Vitest/Playwright `--shard=i/n`, or the CI's node index env (`CI_NODE_INDEX`, `BUILDKITE_PARALLEL_JOB`, …). The Argos-compat endpoint maps Argos's parallel fields. If no index is available, a per-shard id the CLI generates is used, so duplicates still collapse.

### 7.2 Baseline resolution (the subtle part)

**Eligible baseline:** a build of the **same project and same `name`** with status `complete` that is either
- `review_status = approved` (manually or auto-approved), or
- `conclusion = no_changes` and not rejected. It matched its own approved baseline, so it's an equally valid baseline. Otherwise, with auto-approve off, no-change builds would never become baselines and comparisons would drift further and further back.

Every step below applies this filter. Pick the build to compare against, in this order:
1. **PR build:** walk `ancestor_shas` (starting at the merge-base) and take the first commit that has an eligible build.
2. **Default-branch build:** walk `ancestor_shas` (starting at HEAD~1) and take the first commit that has an eligible build.
   **Where the history comes from**, tried in order and recorded as `baseline_source`:
   1. `cli`: our CLI or SDKs (§7.1).
   2. `sdk`: an Argos SDK's merge-base / parent-commit fields, through the compat endpoint (§3).
   3. `provider`: the connected git host's API (`getMergeBase` + recent commits of the base branch), cached per (repo, head, base).
   4. `fallback`: step 3 below.

   The build page shows the source ("Baseline from: SDK history / GitLab API / fallback — latest main build"). For `fallback`, it adds a hint on how to get exact baselines:
   - **`zopheros argos-env` wrapper** for Argos-SDK users on hosts without an integration: `npx zopheros argos-env -- npx playwright test`. It runs our ancestry collection (§7.1), registers the result under the commit (`POST /v1/ancestry`, keyed by project + commit SHA), then runs the wrapped command unchanged. The compat endpoint picks up that history when the Argos SDK creates the build, so no Argos config changes are needed.
3. **Fallback:** the latest eligible build on the default branch.
4. **None found:** every screenshot is `added`; build is an "orphan" (UI says so, check is neutral).

When the same commit has several eligible builds of the same name (re-runs), take the newest.

Building this as a pure function in `packages/core` with good unit tests matters more than anything else in the project. Wrong baselines are the #1 way these tools lose trust.

### 7.3 Diffing (worker)

- Pair screenshots by `name`: head-only → `added`, base-only → `removed`, same sha → `unchanged` (no work), different → enqueue diff job.
- Diff job: fetch both files (local LRU disk cache), normalize to RGBA with sharp, run odiff with anti-aliasing detection, compute score = changed pixels / total, write diff PNG to storage.
  - **Different dimensions → always `changed`**, whatever the score. The images are padded to the larger size only to draw the diff image. A 2px height change on a tall page is a tiny share of pixels, and the threshold must not hide a layout shift. The UI shows "size changed 1280×4000 → 1280×4002".
  - Same dimensions: `score <= project.diff_threshold` → `unchanged`, otherwise `changed`.
- Generate WebP thumbnails for the UI lists.
- When all diffs finish: set build `complete` + conclusion, enqueue `notify` job.

### 7.4 Review & notification

**Status mapping (all providers)**

| Build state             | `block_merge_on_changes = true` (default)                         | `= false`                              |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| No changes              | ✅ success                                                        | ✅ success                             |
| Changes, pending review | ❌ **failure/pending** (blocks if the status is a required check) | ✅ success, with "N changes to review" |
| Approved                | ✅ success                                                        | ✅ success                             |
| Rejected                | ❌ failure                                                        | ❌ failure                             |
| Processing error        | ❌ failure                                                        | ⚠️ success + warning                   |

Blocking only works if the repo marks the Zopheros status as **required** (branch protection / protected branches / merge checks). Docs cover this for each host.

**`GitProvider` interface** (in `packages/providers`):
```ts
interface GitProvider {
  setCommitStatus(repo, sha, { state, title, summary, url, context }): Promise<void>
  upsertPullRequestComment(repo, prNumber, marker, body): Promise<void>
  getMergeBase?(repo, base, head): Promise<string | null> // optional fallback only
  verifyWebhook?(req): WebhookEvent | null // optional
}
```
| Host                          | Status API      | Comment API    | Auth                        |
| ----------------------------- | --------------- | -------------- | --------------------------- |
| GitHub (cloud + GHES)         | Check Runs      | Issue comments | GitHub App                  |
| GitLab (cloud + self-managed) | Commit statuses | MR notes       | Project/group access token  |
| Bitbucket Cloud / DC          | Build statuses  | PR comments    | App password / access token |
| Gitea / Forgejo               | Commit statuses | Issue comments | Access token                |

**Merge gate: who blocks the merge**
- **Integration connected (GitHub, GitLab, Bitbucket, Gitea/Forgejo): the Zopheros commit status is the gate.**
  - The repo marks the `zopheros/<build-name>` status (or GitHub check) as required. `zopheros upload --wait` waits only for _processing_ to finish and **exits 0 even with unreviewed changes**, so the CI job stays green and test failures aren't confused with visual changes. It exits non-zero only for upload or processing errors.
  - Approving or rejecting in the UI (or from the GitHub bot) updates the status within seconds. **No CI re-run needed.**
  - New pushes get a fresh pending status; old builds on the same PR are marked superseded.
- **No integration:** `--wait` **exits non-zero** while changes are unreviewed, so the CI job is the gate. After approval, the build page and the outgoing webhook show "Approved — re-run the `<job>` job to unblock", with a direct link if the CI provides a job URL (e.g. `CI_JOB_URL`, `BUILD_URL`).
- `--wait` picks the mode automatically from the project's settings; `--gate=status|exit-code` overrides it.
- Optional outgoing **webhook** per project (`build.completed`, `build.reviewed`, HMAC-signed) for custom integrations or chat notifications.

**GitHub bot (Zopheros GitHub App)**

Like the Argos bot, it shows up on PRs as **`<app-name>[bot]`**. Each self-hosted instance runs its own GitHub App, because webhooks must reach that instance's server.
- **One-click setup:** Settings → Integrations → GitHub → "Create GitHub App" uses GitHub's **App Manifest flow**. It pre-fills name, logo, webhook URL (`https://zop.example.com/webhooks/github`), permissions and events. GitHub redirects back, and Zopheros stores the app id, private key and webhook secret (encrypted). Works with GitHub.com and GitHub Enterprise Server (base URL setting). A manual setup path with the same values is documented.
  - **Permissions:** Checks (write), Commit statuses (write), Pull requests (write, for comments), Contents (read: merge-base / commit lookups), Metadata (read), Members (read, optional, for mapping org members).
  - **Events:** `installation`, `installation_repositories`, `pull_request`, `check_run` (for button clicks), `issue_comment` (for commands).
- **Install → link:** an org admin installs the app on repos. Zopheros lists the installed repos so each project can be linked in one click; the project's provider connection is created automatically.
- **Check run per build name** (`Zopheros / default`, `Zopheros / vitest-chromium`):
  - The title gives counts ("3 changed, 1 added — review required"). The summary has a markdown table with thumbnails of the first changed screenshots, linked to the review page.
  - **Action buttons** (Checks API `requested_action`): **Approve** and **Reject** right on the GitHub checks tab.
  - The conclusion follows the status-mapping table above: `action_required` while pending when merges are blocked, `success` after approval.
- **PR comment** (one per PR, edited in place):

  | Build           | Status              | Changes             | Review      |
  | --------------- | ------------------- | ------------------- | ----------- |
  | default         | 🟡 Changes detected | 3 changed · 1 added | [Review](…) |
  | vitest-chromium | ✅ No changes       | —                   | —           |

  Plus the **Sites** row (§7.6) and the baseline source when it isn't exact. It only posts once a PR has a build; projects can turn comments off and keep checks only.
- **Comment commands:** `/zopheros approve`, `/zopheros reject`, `/zopheros rerun` (re-process the build, e.g. after changing the threshold). The bot reacts with 👍 on success, or replies with the reason it refused.
- **Who may approve from GitHub** (buttons and commands): the GitHub user must be linked to a Zopheros user (GitHub OAuth login, matched by GitHub user id, never by email) with role `member` or higher in the project's org. If they aren't linked, the bot replies "Link your GitHub account at zop.example.com/settings/identities". Optionally a project can instead accept _repo write access on GitHub_ as enough, for teams that don't want to manage Zopheros roles.
- Every review records where it came from (`ui` | `github-check` | `github-comment`) in the audit log.
- Webhook signatures are verified, deliveries are processed idempotently by delivery id, and GitHub's rate limits are respected (check/comment updates are debounced per PR).
- Other hosts get statuses + comments through their adapters (§ above). Bot-style buttons and commands are GitHub-only in v1; GitLab MR comment commands come later (M4).

**Other behavior**
- Default-branch builds auto-approve when configured, so they become baselines.
- Approve/reject in the UI writes a `review` row (with `source`) and re-runs `notify`.
- Provider comment: one comment per PR, updated in place and found by a hidden marker, with changed/added/removed counts per build name.

### 7.5 Review UI

- Project list → builds list (filter by branch/PR/status) → build page.
- Build page: grouped sidebar (Changed / Added / Removed / Unchanged), main viewer with **side-by-side, overlay diff, and swipe slider** modes, zoom/pan synced across panes, keyboard shortcuts (j/k next/prev, a approve, r reject).
- Big builds (1000s of screenshots): virtualized lists, thumbnails, lazy full-res loading.
- If the build has a hosted Storybook: an **"Open story"** button on each screenshot, plus an optional live iframe tab next to the diff (§7.6).

### 7.6 Static-site hosting (optional): one pipeline for every kind

Off by default; enabled per project (`static_hosting_enabled`) and for the whole instance with `STATIC_SITES_HOST`. Reviewers can open the real Storybook, test report, coverage report or docs for the exact commit they're reviewing, next to the screenshots.

Every site goes through the same five stages. Only a small **kind definition** differs:

```
upload ─▶ ingest ─▶ serve ─▶ alias ─▶ link
(CLI)     (worker:   (wildcard  (branch/  (build page, PR/MR comment,
           extract,   subdomain) pr/latest) commit status, deep links
           dedupe)                          from screenshots)
```

**Kind registry** (`packages/sites/kinds/*.ts`):
```ts
interface SiteKind {
  id: 'storybook' | 'vitest-report' | 'playwright-report' | 'coverage' | 'docs' | 'generic'
  label: string // "Storybook", "Vitest report", …
  detect(files: string[]): boolean // for --kind auto
  entryPath(files: string[]): string // default page, e.g. index.html
  spaFallback: boolean // serve entry for unknown paths
  headers?(path: string): Record<string, string> // per-kind tweaks (e.g. Service-Worker-Allowed)
  deepLink?(meta: ScreenshotMetadata): string | null // screenshot → page in this site
}
```

| Kind                | Detected by                                                       | Deep link from a screenshot                              | Notes                                                                                    |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `storybook`         | `iframe.html` + `index.json`/`stories.json`                       | `iframe.html?id=<storyId>&viewMode=story`                | Live before/after iframe in the review UI                                                |
| `vitest-report`     | Vitest HTML reporter markers (`html.meta.json.gz` + `index.html`) | test file/name → report entry                            | §7.7                                                                                     |
| `playwright-report` | `index.html` + `data/` + `trace/`                                 | `#?testId=<id>` (the Playwright SDK records the test id) | The trace viewer uses a service worker. That's fine because each site has its own origin |
| `coverage`          | `lcov-report` / Istanbul / v8 HTML markers                        | source file → coverage page                              | Optional: parse the summary for a "Coverage 84.2%" badge in the PR comment               |
| `docs`              | Explicit only (`--kind docs`)                                     | none                                                     | `spaFallback` opt-in for VitePress/Docusaurus/Next export                                |
| `generic`           | Fallback                                                          | none                                                     | Any static folder                                                                        |

Adding a kind means one file with a detector and optional deep-link function. No schema, API or UI changes, because the UI renders sites from the registry (label, icon, link).

**Upload**
- One command for everything: `zopheros site upload <dir> [--kind auto|storybook|…] [--name <slug>] [--spa]`.
  - `zopheros storybook upload <dir>` is a shortcut for `site upload --kind storybook`.
  - `zopheros upload <screenshots> --site <dir>[:kind[:name]]` (repeatable) attaches sites to the screenshot build in one step.
  - SDKs can upload their own reports at the end of a run: Playwright reporter `uploadReport: true`, Vitest plugin `uploadReport: true`.
- Uses the same CI detection, git ancestry and project token as screenshot builds. A site without a screenshot build still gets commit/branch/PR info, so it gets aliases and a PR comment line.
- **Two transports:**
  - **Tarball (default; best for local disk):** the CLI streams a `.tar.gz` to `POST /v1/sites`. The worker extracts it, hashes each file, dedupes into `files`, writes `static_site_files`, then marks the site `ready`. One request, even for 3,000-file Storybooks.
  - **Per-file (S3 driver):** hash manifest → presigned PUTs for missing files only → finalize. Same pattern as screenshots; saves bandwidth when most assets haven't changed.
- Limits: max site size (default 200 MB), max file count, zip-bomb ratio checks. Tarball entries: **only regular files and directories are accepted**. Symlinks, hard links, device files and FIFOs are rejected, as are `..` segments, absolute paths and paths that normalize outside the root.
- Per-file transport uses the same checksum-verified PUTs, upload claims and verified-only dedup as screenshots (§8). The tarball transport hashes files server-side, so they're verified when written.
- Also works with the Argos SDKs: screenshots go through the compat API, then a separate `zopheros site upload` step uploads the site.
- Re-uploading the same (commit, name) replaces the earlier site (CI re-runs), and the old one becomes eligible for garbage collection.

**Serving**
- **Host layout:**

  | URL                                    | What                                                                                   | Env                                   |
  | -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
  | `https://zop.example.com/`             | Dashboard, API, login, aliases, site menu                                              | `PUBLIC_URL`                          |
  | `https://<site-id>.example-sites.com/` | One hosted site per subdomain, on a **separate registrable domain** used only for this | `STATIC_SITES_HOST=example-sites.com` |

  A Storybook or report runs arbitrary JS from the uploaded build.
  - **Why a separate domain:** browser JS can set cookies on any parent domain that isn't a public suffix. On `*.zop.example.com`, a malicious upload could run `document.cookie = '…; Domain=example.com'` and fill the cookie jar until the dashboard _and every other `example.com` site_ fail with "header too large" for that user, or plant cookies that other apps on `example.com` read. Server-side rules can't stop this. On `example-sites.com`, the worst an upload can reach is other Zopheros sites. GitHub Pages (`github.io`) and Netlify (`netlify.app`) use the same model.
  - One origin per site also means a site can't read another site's storage or service workers.
  - `site-id` is a 26-char lowercase base32 id (128-bit, fits in a DNS label).
  - **There is no single-hostname fallback.** Serving uploads from the dashboard origin would give them the viewer's full session. Wildcard DNS on the sites domain is required for static hosting; without `STATIC_SITES_HOST` the feature is off. On startup the server refuses a `STATIC_SITES_HOST` that equals `PUBLIC_URL`'s host, is above it, or is below it.
- **Hardening that remains** (the dashboard and sites are now cross-site, so SameSite cookies already protect the dashboard; these are defense in depth):
  - All dashboard cookies use the **`__Host-` prefix** (no `Domain`, `Path=/`, Secure, SameSite=Lax) and HttpOnly.
  - State-changing dashboard requests need a **CSRF token** plus an exact `Origin` check for `https://zop.example.com`.
  - No CORS on the API for the sites domain. Site responses get `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and **CSP `frame-ancestors 'self' https://zop.example.com`**. There's no `X-Frame-Options`, because it can't allow one specific other origin and would block the review iframe.
  - **Cookie cleanup on the sites domain:** the site handler accepts large request headers (64 KB). If a request carries cookies other than its own `__Host-zop_site*`, it answers with `Set-Cookie` expiring them on the domain. A cookie bomb from one upload clears itself on the next request instead of locking the user out of every site.
  - Optional, for large installs: submit the sites domain to the **Public Suffix List** (as `github.io` is). Browsers then treat each site subdomain as its own site, so they can't set cookies for each other at all. The PSL is slow to reach browsers, so this is not something to rely on.
  - The site handler only answers on `<26-char-id>.example-sites.com`, and the app only on `zop.example.com`. Anything else gets a 404.
- **DNS + TLS (Route53):**
  - `zop` A/AAAA record in the `example.com` hosted zone, and `*` A/AAAA in a new `example-sites.com` hosted zone (the apex can stay empty).
  - Let's Encrypt certs for `zop.example.com` (HTTP-01 is enough) and `*.example-sites.com` (needs **DNS-01**).
  - `deploy/` ships a Caddy image built with `caddy-dns/route53` (via `xcaddy`) and a Caddyfile covering both, with automatic renewal.
  - Credentials: an IAM role on EC2 (preferred) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Docs include a minimal IAM policy (`route53:ChangeResourceRecordSets` + `ListResourceRecordSets` on **the sites hosted zone only**, + `route53:GetChange`) and a Terraform snippet for both zones' records.
  - Other DNS providers: swap the Caddy module (one line in the Dockerfile).
- **Domain rules: a ⚠️ warning step in the setup guide.** Zopheros can't enforce these, so the docs do:
  - **The sites domain is dedicated to Zopheros.** Host nothing else on it, not even its apex or `www`, and never set cookies on it. Anything else there shares a cookie scope with untrusted uploads.
  - **Nothing on `example.com` may set cookies for the whole domain** (`Domain=example.com`). Uploads can't reach those cookies any more, but every `example.com` cookie is still sent to the dashboard. Keeping them host-scoped is part of the same hygiene step.
  - The setup guide has a dedicated step, "Step: check domain and cookie rules", right after the DNS step. It has a **⚠️ warning callout** explaining both rules, how to check (browser devtools → Application → Cookies, or `curl -sI https://<host> | grep -i 'set-cookie.*domain='`), and how to fix them. The same warning appears on the static-hosting docs page and in the `deploy/` README.
  - `zopheros doctor` (a deploy check command) does a best-effort check. It fetches `example.com`, `www.example.com` and the sites domain apex, and warns about any `Set-Cookie` with a `Domain=` attribute, or anything served on the sites apex. It also repeats the warning, since it can't see every host.
- Stable aliases live on the app host and redirect to the current site subdomain: `https://zop.example.com/<org>/<project>/sites/<name>/{branch/<branch>,pr/<n>,latest}[/<path>]`. The optional path is passed through, so a link like `…/sites/docs/latest/guide/setup` works. This keeps alias names (which may contain `/`, long branch names, etc.) out of DNS labels.
- Caching is the same for every kind:
  - Non-HTML files get `Cache-Control: private, max-age=31536000, immutable`, with the file's sha256 as ETag. `private` because every response needs login, so shared caches must not store it; `immutable` because a site's files never change after `ready`.
  - HTML gets `private, no-cache`. Its **ETag is computed from the bytes actually sent**: the file sha256 plus whether the switcher is injected, plus the switcher version. Adding a second site to a ref changes the HTML ETag, so browsers fetch the page again and see the switcher instead of getting a stale 304.
  - Unknown paths → kind's `spaFallback` (or `--spa`) decides between the entry page and a 404.
- Response headers: `X-Content-Type-Options: nosniff`, the CSP `frame-ancestors` above, no `Set-Cookie` except the site's own auth cookies and the cookie cleanup.
- No CDN by default: since every request needs login, a plain CDN would either skip the check or cache nothing. Browser caching (`private, immutable`) does most of the work. If needed later, CloudFront with signed cookies issued during the SSO handoff can cache sites while still requiring login (M4).

**Access control: login always required, single sign-on across all sites**
- Every request to a site subdomain needs a valid per-site cookie. There is no public mode.
- Flow when opening `k3f9….example-sites.com/…` without a site cookie:
  1. The site handler redirects to `https://zop.example.com/_sso/site?site=k3f9…&return=/path`.
  2. Not logged in to the dashboard → show the login page (email login / password / OIDC, whichever is enabled). Already logged in → no prompt, so you sign in once for everything.
  3. The app checks the user is a member of the site's org with at least `viewer` role, then redirects back with a **single-use, 60 s token bound to that site id** (`/_zopheros/auth?t=…`).
  4. The site handler swaps the token for a `__Host-zop_site` cookie (HttpOnly, Secure, SameSite=Lax), valid for that subdomain only. It's a short-lived (1 h, sliding) reference to the dashboard session, so **logging out or revoking a session or membership cuts off site access within a minute**: the site handler re-checks the session against a cached lookup with a 60 s TTL.
- Site cookies are useless on other site subdomains or on the dashboard. A malicious upload can't use them to reach other sites or the API.
- **Embedded live view** (Storybook iframe in the review UI): the site is cross-site to the dashboard there, so a Lax cookie isn't sent. The same handoff runs inside the iframe and sets `__Host-zop_site_embed` (`SameSite=None; Secure; Partitioned`), which is only valid inside the dashboard's frame. Where a browser blocks even partitioned cookies, the UI detects the failed handoff and shows "Open live view in new tab" instead.

**Site navigation**
- Each ref has a **site menu** page: `https://zop.example.com/<org>/<project>/sites/{commit/<sha>,pr/<n>,branch/<b>,latest}`. It's the starting point that PR/MR comments, commit statuses and the build page link to.
  - It shows a card per hosted site for that ref (label, icon and name from the kind registry, upload time, size), plus links to the screenshot build and the same sites on the base branch.
  - **Exactly one site → no menu:** a 302 straight to that site, with no switcher. The menu only appears when there's something to choose between.
  - Zero sites → "No sites uploaded for this commit", with the CLI snippet.
- **Switcher inside sites (only when the ref has 2+ sites):** the site handler injects one `<script src="/_zopheros/nav.js" data-site=…>` before `</body>` in HTML responses.
  - It renders a small collapsible pill in a Shadow DOM (so it can't clash with the site's CSS), with a dropdown of the other sites on the same ref and "← All sites" back to the menu.
  - **Both the script and its data come from the site's own origin**, so no CORS is needed and the "no CORS for the sites domain" rule holds. The site handler serves `/_zopheros/nav.js` (a versioned build of the switcher) and `/_zopheros/sites.json`. The JSON lists the ref's sites, with links that go through the app's aliases, and is authorized by the site cookie. The handler reads Postgres directly; the switcher never calls the dashboard API.
  - The `/_zopheros/` path prefix is reserved on every site. Uploads containing it are rejected.
  - It can be disabled per project (`site_nav_injection: false`) or per upload (`--no-nav`) for sites that break with injected markup. The menu page still works in that case.
  - Each kind can choose where the pill sits so it doesn't cover the site's own nav (e.g. bottom-left for Storybook, top-right for Playwright reports).

**Integration with reviews**
- The build page shows a **Sites** panel listing every site for the commit (label and icon from the kind).
- On each screenshot, every site whose kind's `deepLink(meta)` returns a URL gets a button ("Open story", "Open in Playwright report", …). Storybook can also be embedded live, showing base and head sites side by side.
- The PR/MR comment has one **Sites** row per site, built from the registry (e.g. `Storybook · Vitest report · Coverage 84.2% · Docs`), using `pr/<n>` aliases so links stay valid across pushes. The commit status links to the build page.

**Retention**
- Same `retention_days` as builds. Sites that an alias currently points to (e.g. the latest default-branch site) are never deleted. Blobs are removed by the shared GC (§8), which respects upload claims and the grace period.

### 7.7 Vitest integration

Vitest **browser mode** runs component tests in a real browser (Playwright or WebdriverIO provider), so it can capture screenshots just like Playwright. `@zopheros/vitest` covers three cases:

**1. Screenshots from component tests**
```ts
// vitest.config.ts
import { zopheros } from '@zopheros/vitest/plugin'
export default defineConfig({
  plugins: [zopheros()],                // adds reporter + setup file, reads ZOPHEROS_TOKEN
  test: { browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] } },
})

// Button.test.tsx
import { zopherosScreenshot } from '@zopheros/vitest'
test('primary button', async () => {
  render(<Button variant="primary">Save</Button>)
  await zopherosScreenshot('button-primary')               // whole viewport
  await zopherosScreenshot('button-primary-el', { element: page.getByRole('button') })
})
```

- The helper (browser side) **stabilizes** before capturing: waits for `document.fonts.ready` and pending images, disables CSS animations and transitions, hides the caret, and optionally waits for network idle. It then calls Vitest's `page.screenshot()` / `locator.screenshot()` (from `vitest/browser`) and writes to `.zopheros/screenshots/`.
- Metadata saved per screenshot: test file, full test name, browser and viewport, Vitest version, retry count, and `colorScheme`. The server pairs screenshots by `name`, falling back to `file › test title`.
- The **reporter** (Node side, `onTestRunEnd`) uploads everything at the end of the run, with one build per `instances[]` browser (build name = `vitest-chromium` etc.). It handles Vitest sharding (`--shard=i/n`) by mapping to `parallel: {nonce, total}` automatically.
- **Vitest 4 `toMatchScreenshot`**: an optional mode collects those screenshots instead of comparing them against local reference files in git. Teams already using it can switch with no test changes, and reference PNGs no longer bloat the repo.

**2. Storybook via its Vitest addon**
- Storybook's `@storybook/addon-vitest` runs every story as a Vitest browser test. With `zopheros({ storybook: true })`, each story is screenshotted automatically after its `play` function finishes. Metadata includes `storyId`, so the review UI links straight to the hosted story (§7.6). Stories can opt out with `parameters.zopheros = { disable: true }` or set viewports and modes.
- This replaces a separate Storybook screenshot runner: one `vitest` command produces screenshots, and `zopheros storybook upload` hosts the static build.

**3. Hosted Vitest reports**
- `uploadReport: true` in the plugin (or `zopheros site upload ./html`, auto-detected as `vitest-report`) hosts the `vitest --reporter=html` output through the §7.6 pipeline.
- Coverage HTML (`coverage/`) is auto-detected as `coverage`.

**Compatibility:** test against Vitest 3.2+ and 4.x with both the Playwright and WebdriverIO providers. CI matrix in the Zopheros repo.

### 7.8 Login methods & email login

All login happens at `https://zop.example.com/login`. The dashboard session it creates is the single sign-on for every hosted site (§7.6).

**Methods**, each can be turned on or off:

| Method          | How it works                                                                                                                                                | Instance switch                                 | Per-org switch                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| **Email login** | Enter email → get a mail with a magic link **and** a 6-digit code (the code covers mail clients that pre-open links, or opening the mail on another device) | `AUTH_EMAIL_ENABLED`                            | `auth_settings.email_login_enabled`          |
| Password        | Email + password (argon2id), optional TOTP                                                                                                                  | `AUTH_PASSWORD_ENABLED`                         | `password_login_enabled`                     |
| OAuth / OIDC    | GitHub, GitLab, Google, or any OIDC issuer (Okta, Entra ID, Keycloak, Authentik…)                                                                           | `AUTH_OIDC_ENABLED` + instance-scoped providers | Org-scoped providers (restricted, see below) |

**Email login details**
- Magic links point to a confirm page (`/login/email/confirm?t=…`) that needs a button click (POST). Corporate mail scanners that pre-open links can't use them up.
- Codes and links are single-use, hashed at rest, valid for 10 minutes, with 5 code attempts per challenge. Both are rate limited per email and per IP.
- The response is the same whether or not the email has an account, so attackers can't find out which emails exist. With signups disabled, unknown emails just get nothing.
- **Allowed email domains:** an org can list domains (`example.com`). Anyone who logs in with an address on that domain that **Zopheros itself verified** auto-joins the org with `auto_join_role` (default `viewer`). Teammates then need no invites.
  - "Zopheros verified" means email login (we sent the code) or an instance-scoped OIDC provider an operator marked `trusted_for_email`. An `email_verified` claim from an org-scoped provider never counts.
  - Claiming a domain needs proof: a DNS TXT record (`_zopheros-verify.example.com`). Otherwise any org could list `gmail.com` or a competitor's domain.

**OIDC trust rules** (so one org's identity provider can't take over accounts in another org)
- Identities are matched by **(issuer, subject)**, never by email. A first OIDC login never attaches to an existing user just because the email matches.
- **Instance-scoped providers** (set up by the server operator in env/config) can be marked `trusted_for_email`. For those, a verified email may link to an existing account, but only after that account confirms by email-login code ("Link your Okta login to this account?"), and it may trigger domain auto-join.
- **Org-scoped providers** (added by an org admin) are untrusted for anything beyond their own org:
  - their logins create or match only identities under that provider;
  - the session they create **only grants access to that org**: other orgs' content asks the user to re-authenticate with a method that org accepts;
  - they never link to existing accounts by email and never trigger auto-join for any org.
- So an org admin who points their own IdP at `ceo@victim.com` gets a separate user who can only see the admin's own org.
- Email is sent over `SMTP_*`; Amazon SES fits the Route53/AWS setup. Mail templates can be customized (logo, org name).

**Turning methods on and off**
- The instance env flags are the outer limit; orgs can only narrow them. When a method is off, its UI and endpoints disappear, and existing sessions created through it stay valid unless "revoke sessions" is ticked.
- **Lockout guard:** you can't turn off the last method that any owner of the org can log in with. The settings page explains why.
- Break-glass: `zopheros admin auth enable email --org <slug>` (CLI on the server) for when an IdP goes down.
- If a user is in several orgs, they can log in with any method the instance allows, but each org's own rules are enforced when its content is accessed. Example: org A allows only OIDC, so a session from email login gets "re-authenticate with Okta" on org A's builds and sites.

---

## 8. Security & ops

- **Org isolation:** every query is scoped by `org_id` and enforced in one data-access layer. Tests check that cross-org access returns 404.
- **Roles:** owner (billing-free, so: delete org, manage owners) · admin (projects, provider connections, members) · member (review builds) · viewer (read only). Instance-level `superadmin` flag for the operator.
- **Signups & first run (defaults):**
  - **First run:** with no users in the database, the server prints a one-time **setup link** (`https://zop.example.com/setup?t=…`) to its log. It's valid for 24 h and can be regenerated with `zopheros admin setup-link`. Whoever opens it creates the first account and becomes `superadmin`. Until then, every other page shows "Instance not set up yet".
  - **Invite-only by default** (`SIGNUPS_ENABLED=false`): new accounts come only from org invites, or from **email-domain auto-join** into an org that has verified that domain (§7.8). Anyone else trying to log in gets the same neutral response as for unknown emails.
  - **Only the superadmin creates orgs** by default (`ORG_CREATION=admin`). This stops users from creating orgs and filling the disk.
  - Public instances can set `SIGNUPS_ENABLED=true` and/or `ORG_CREATION=anyone`. The admin UI can change both at runtime (stored in `instance_settings`; env sets the initial value).
- Provider credentials are encrypted at rest (AES-GCM, key from `ENCRYPTION_KEY`).
- Project CI tokens: random 32 bytes, stored hashed, shown once. Scopes: **create builds and sites, upload files, and read status of that project's builds** (`GET /v1/builds/:id/status`, used by `--wait` and SDK reporters). They can't review, read screenshots or change settings.
- **Upload integrity: verify before dedup.** The dedup store is shared across builds and orgs, so a hash must never be trusted before the bytes are checked.
  - A `files` row starts as `pending` and becomes `verified` only after the bytes are confirmed. **Dedup only matches `verified` rows**; a `pending` hash gets its own presigned URL again.
  - S3 driver: presigned PUTs require `x-amz-checksum-sha256` (supported by AWS S3, R2 and MinIO), so storage rejects bytes that don't match. Finalize then does a `HEAD` to confirm the object and checksum before marking it verified. Short TTL, content-length and content-type constraints stay.
  - FS driver: uploads stream through the API, which hashes while writing to a temp file and only renames it into place if the hash matches.
  - Image metadata (width/height) is read by the worker from verified bytes, never taken from the client.
- **Garbage collection without races** (mark, wait, re-check, then delete):
  1. _Mark:_ files with no references (screenshots, diffs, thumbnails, site files, **upload claims**) get `gc_marked_at = now()`.
  2. _Grace:_ nothing marked less than 24 h ago is touched. Any new reference clears the mark.
  3. _Sweep:_ in one transaction, `SELECT … FOR UPDATE` the row, re-check that there are still zero references and claims, then delete the row. The object is deleted after commit.
  4. Dedup in `POST /v1/builds` takes `FOR SHARE` on the `files` row while inserting its upload claim, so it either sees the row before sweep deletes it (and the claim blocks the delete) or doesn't see it (and uploads afresh). Objects have generation-suffixed keys, so deleting an old object can't remove a new upload of the same hash.
- Images are served through signed URLs or an authenticated proxy. Screenshots of internal apps are sensitive.
- GitHub App private key + webhook secrets come from env/secret files; verify webhook signatures for every provider.
- Config entirely via env (`DATABASE_URL`, `STORAGE_DRIVER=fs|s3`, `STORAGE_PATH`, `S3_*`, `PUBLIC_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `SMTP_*`, `OIDC_*`, `GITHUB_APP_*` (optional; the manifest flow stores these in the DB instead), `SIGNUPS_ENABLED` (default false), `ORG_CREATION=admin|anyone` (default admin), `AUTH_EMAIL_ENABLED` (default true), `AUTH_PASSWORD_ENABLED`, `AUTH_OIDC_ENABLED`, `STATIC_SITES_HOST` (a separate, dedicated domain, e.g. `example-sites.com`), `STATIC_SITES_MAX_MB`).
- Static-site uploads run untrusted code in viewers' browsers. Each one gets its own `<id>.example-sites.com` origin on a domain separate from the dashboard, and is never served from `PUBLIC_URL` (there's no fallback mode). Dashboard cookies are `__Host-` only, state-changing requests need CSRF tokens and an exact-`Origin` check, host routing is strict, and cookie bombs on the sites domain clear themselves (§7.6). Security tests try cookie bombing, cookie tossing and CSRF from a malicious uploaded site.
- Email login: rate limits per email and per IP, codes hashed, 5 attempts per challenge, 10 min expiry, no user enumeration (same response whether or not the email exists), and a "new sign-in" email notification (§7.8).
- Health endpoints, structured logs (pino), Prometheus metrics (queue depth, diff duration, build latency).
- Backups: Postgres dump + bucket versioning. Document both.

---

## 9. Milestones

### M0 — Foundations (≈1 week)

_Status: done, except the Docker image build and compose smoke test, which are defined in CI (`docker-smoke` job) but have not run anywhere yet: there is no remote, and Docker was not running locally._

- [x] pnpm monorepo, TS config, lint/format (oxlint + oxfmt), Vitest, GitHub Actions CI
- [x] Postgres schema + migrations (Drizzle; M0/M1 tables, constraints from §6), storage driver interface (FS + S3) with checksum-verified writes and presigned PUTs
- [x] `docker-compose.yml` with postgres + app (local-disk volume); `docker-compose.s3.yml` overlay with MinIO; `zopheros all` entrypoint, `/healthz` + `/readyz`, graceful shutdown
- [x] Org + project creation via an admin CLI command (no UI yet), token issuance + rotation

### M1 — Upload → diff → view (≈2 weeks) — _first usable version_

- [ ] Upload API (create build, presigned URLs, finalize) with **verify-before-dedup** (`pending`/`verified` files, S3 checksum PUTs, FS hash-on-write) and upload claims
- [ ] Native CLI `zopheros upload <dir>` with CI env detection, git ancestry from the PR head SHA (base-branch fetch + deepen), `--wait` exit code
- [ ] CI token scopes: create/upload + read build status
- [ ] Baseline resolution from CLI-provided ancestry (§7.2) with the eligibility filter (same name, complete, approved or no-changes), table-driven unit tests
- [ ] Worker: pairing, odiff diffing, thresholds, **dimension change → always changed**, thumbnails, build completion
- [ ] Minimal UI: builds list + build page with side-by-side and overlay
- [ ] E2E test: upload fixture screenshots twice with a changed image; assert diff results

### M2 — Organizations, auth & review (≈2 weeks)

- [ ] Pluggable login methods; **email login (magic link + 6-digit code)** with rate limiting; password login; sessions list and revoke
- [ ] Turning login methods on/off: instance env flags + per-org `auth_settings`, lockout guard, `zopheros admin auth` break-glass command
- [ ] Allowed email domains → auto-join org with a default role
- [ ] Organizations, memberships, roles, invites; org/project settings UI
- [ ] First-run setup link, invite-only default, `SIGNUPS_ENABLED` / `ORG_CREATION` (env + admin UI)
- [ ] OAuth/OIDC login (GitHub, GitLab, Google, generic OIDC). Instance vs. org-scoped providers, (issuer, subject) matching, `trusted_for_email`, org-scoped sessions, confirmed account linking
- [ ] Email-domain claims verified by DNS TXT record
- [ ] Approve/reject flow; auto-approve on default branch; `block_merge_on_changes` setting
- [ ] Outgoing signed webhooks

### M2.5 — Git provider adapters + GitHub bot (≈3 weeks)

- [ ] `GitProvider` interface + shared status/comment rendering
- [ ] **GitHub bot**: App Manifest one-click setup (GitHub.com + GHES), install → repo/project linking, check run per build name with thumbnails and **Approve/Reject buttons**, PR summary comment, `/zopheros approve|reject|rerun` commands, GitHub-user → Zopheros-user mapping by GitHub id, review `source` audit, idempotent webhook handling + debounced updates
- [ ] Merge-gate modes: status gate when an integration is connected (`--wait` exits 0 on unreviewed changes), exit-code gate otherwise with "re-run to unblock" link; `--gate` override
- [ ] GitLab (commit status, MR note; cloud + self-managed base URL)
- [ ] Gitea/Forgejo (commit status, PR comment)
- [ ] Bitbucket Cloud/DC (build status, PR comment)
- [ ] Docs per host for making the status a required check

### M3 — CI ergonomics (≈1–2 weeks)

- [ ] Sharded/parallel builds: unique (project, name, commit, nonce) with `ON CONFLICT`, `build_shards` by index (idempotent retries), timeout listing missing shards
- [ ] Multiple build names per commit (e.g. `chromium`, `mobile`, `storybook`)
- [ ] Check which commit-history fields the Argos SDK sends (from its source)
- [ ] **Argos API compatibility layer** (maps SDK history fields) + contract tests running the real `@argos-ci/cli` and `@argos-ci/playwright`
- [ ] History source order cli → sdk → provider → fallback, `baseline_source` shown on the build page; `zopheros argos-env` wrapper + `POST /v1/ancestry`
- [ ] **`@zopheros/vitest`**: browser-side `zopherosScreenshot` with stabilization, reporter upload, shard mapping, one build per browser instance
- [ ] Vitest `toMatchScreenshot` collection mode
- [ ] Docs: CI examples (GitHub Actions, GitLab CI, Bitbucket Pipelines, Gitea Actions, Jenkins), Playwright + Vitest setup, migration from Argos

### M3.5 — Static-site pipeline (≈2 weeks)

- [ ] `static_sites` schema (kind + name), tarball ingest worker (regular files + dirs only, no symlinks/hard links/devices, reserved `/_zopheros/` prefix, dedup, size limits)
- [ ] **Kind registry** + built-in kinds: `storybook`, `vitest-report`, `playwright-report`, `coverage`, `docs`, `generic`, with `--kind auto` detection fixture tests per kind
- [ ] `zopheros site upload` (+ `storybook upload` shortcut, `upload --site`); per-file transport for the S3 driver
- [ ] SDK `uploadReport` options (Playwright reporter, Vitest plugin)
- [ ] **Wildcard-subdomain serving on the separate sites domain** (`<site-id>.<STATIC_SITES_HOST>`), startup check that it's unrelated to `PUBLIC_URL`, caching with sent-bytes HTML ETags, SPA fallback
- [ ] Caddy + `caddy-dns/route53` image and Caddyfile in `deploy/` (dashboard host + wildcard sites domain); IAM policy, Terraform snippet for both zones, Route53 setup docs
- [ ] Docs: **"Check domain and cookie rules" setup step with ⚠️ warning** (dedicated sites domain; no `Domain=example.com` cookies), repeated on the static-hosting page and in the `deploy/` README; `zopheros doctor` best-effort check
- [ ] Required-login SSO handoff (`/_sso/site` → single-use token → `__Host-zop_site` cookie), session/membership revocation within 60 s
- [ ] Site menu page per ref (commit/PR/branch/latest) with single-site direct redirect
- [ ] Injected Shadow-DOM switcher served from the site's own origin (`/_zopheros/nav.js` + `sites.json`) for refs with 2+ sites; per-kind position; project/upload opt-out
- [ ] Hardening: `__Host-` dashboard cookies, CSRF + exact-Origin checks, strict host routing, COOP/CORP, `frame-ancestors` (no X-Frame-Options), cookie-bomb cleanup on the sites domain
- [ ] Embedded live view with partitioned cookie + new-tab fallback
- [ ] Name-scoped branch/PR/latest aliases with path passthrough; Sites row in PR/MR comment
- [ ] Review UI: Sites panel; per-screenshot deep-link buttons from the registry; live Storybook before/after iframe
- [ ] `@zopheros/vitest` Storybook-addon mode (auto-screenshot each story with `storyId`)
- [ ] Security tests: path traversal, symlink/hard-link tarballs, cross-site cookie isolation, cookie bombing, cookie tossing and CSRF from a malicious site, app/site host routing

### M4 — Hardening & polish (ongoing)

- [ ] Swipe slider viewer, synced zoom, keyboard nav, virtualized lists
- [ ] Retention + mark/grace/re-check GC (§8) with concurrency tests (GC racing dedup); storage usage page
- [ ] Ignore regions / masks per screenshot name (or rely on SDK-side masking)
- [ ] Flaky detection (a screenshot that keeps changing on the default branch without review)
- [ ] CloudFront in front of sites with signed cookies from the SSO handoff (optional, for heavy traffic)
- [ ] Azure DevOps adapter; GitLab MR comment commands; SAML SSO; per-org storage quotas
- [ ] `zopheros storage migrate` (fs ↔ s3)
- [ ] Helm chart, metrics dashboard, backup docs

---

## 10. Testing strategy

- **Unit:** baseline resolution (table-driven git-history scenarios, mixed build names, no-change builds as baselines, missing ancestry), build state machine, pairing logic, CI env detection.
- **CLI ancestry:** real git fixtures that reproduce CI checkouts (GitHub depth-1 `refs/pull/N/merge` with no base ref, GitLab detached MR pipelines, shallow clones needing deepen). Assert the merge-base equals the PR fork point.
- **Integration:** database tests run on PGlite (real Postgres compiled to WASM, in-process, no Docker); CI also runs the Docker stack and live S3 tests against MinIO. Testcontainers with real Postgres is added in M1 for driver-level concurrency tests. Covers concurrent shard creation, duplicate shard finalize, wrong-bytes uploads rejected by checksum, a pending hash never deduped, and GC racing dedup.
- **Auth:** org-scoped OIDC asserting another user's email can't link or auto-join; unverified domain claims rejected.
- **Diff golden tests:** fixture image pairs (anti-aliasing, 1px shifts, size changes that must be `changed` at any threshold, transparency) with expected status and score bands.
- **E2E:** docker-compose up → run CLI against a sample Playwright project → assert the UI and a mocked GitHub check payload.
- **Contract:** pinned Argos SDK versions against our compat endpoints.

---

## 11. Remaining questions

None open. All earlier questions are resolved in the decisions list (§1). The one item that still needs checking during implementation is which history fields the Argos SDK sends (M3, first task), and the plan works either way.
