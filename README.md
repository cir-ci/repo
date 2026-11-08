# CirCI

Self-hosted visual regression testing: a cheaper alternative to Argos-CI. CI uploads screenshots, the server diffs them against a baseline, and reviewers approve or reject the changes.

**Status: M1 plus accounts.** CI uploads screenshots with `circi upload`, the worker diffs them against the right baseline, `--wait` fails the CI job when changes need review, and a dashboard shows the results to signed-in members of the organization. Accounts, organizations and CI tokens are handled by [better-auth](https://better-auth.com). Email login, single sign-on and git host integrations come next (M2). See [PLAN.md](PLAN.md) for the full design and milestones.

## Uploading from CI

```sh
CIRCI_TOKEN=circi_… CIRCI_API_URL=https://ci.acme.io npx circi upload ./screenshots --wait
```

- Every `*.png` under the directory is a screenshot, named by its path (`settings/profile.png` → `settings/profile`). An optional `<file>.png.json` next to it adds metadata.
- Commit, branch and PR are read from the CI environment (GitHub Actions, GitLab, Bitbucket, Gitea/Forgejo, CircleCI, Buildkite, Jenkins, Azure Pipelines); `CIRCI_COMMIT`, `CIRCI_BRANCH`, `CIRCI_PR_NUMBER` and `CIRCI_BASE_BRANCH` override them.
- Shallow CI checkouts are fine: the CLI fetches the base branch and just enough history to find the right baseline.
- `--wait` exit codes: `0` pass, `1` visual changes need review (blocks the merge), `2` error.

## Webhooks

`circi admin webhook add --org acme --project web-app --url https://hooks.acme.io/circi` prints a signing secret once. Each event is a JSON `POST` with `CirCI-Event`, `CirCI-Delivery` and `CirCI-Signature: t=<unix>,v1=<hex>` headers, where `v1` is HMAC-SHA256 of `<t>.<raw body>` with the secret (`verifyWebhookSignature` in `@circi/core` does this check; reject signatures older than a few minutes). The body has the organization, project, build (number, conclusion, review status, commit, branch, PR), the dashboard `url`, and for `build.reviewed` the decision and reviewer. Any non-2xx answer is retried with backoff (8 attempts); redirects are not followed.

Owners and admins can also add and remove webhooks on the project's **Settings** page (the secret is shown once). Addresses must be public: `localhost`, private networks and cloud metadata addresses are refused, and names are re-checked at delivery. Set `WEBHOOK_ALLOW_PRIVATE_ADDRESSES=true` if your receivers live on your own network.

## GitHub

Create a GitHub App (Settings → Developer settings → GitHub Apps) with webhook URL `PUBLIC_URL/webhooks/github`, a webhook secret, permissions *Checks: write*, *Pull requests: write*, *Metadata: read*, and events *Check run* and *Issue comment*. Install it on your repositories, then set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the PEM; `\n` escapes are fine) and `GITHUB_APP_WEBHOOK_SECRET`; for GitHub Enterprise Server also `GITHUB_API_URL=https://ghe.example.com/api/v3`. Link a project to its repository on its **Settings** page (or `circi admin github link --org acme --project web --repo acme/web --installation 12345678`; the installation id is the number in the installation's settings address).

Each build then shows as a **CirCI / <build name>** check with **Approve** and **Reject** buttons, plus one summary comment on the pull request. Comment `/circi approve`, `/circi reject` or `/circi rerun` to act on the pull request's newest commit. Who may approve from GitHub: people who linked their GitHub login on their CirCI **Account** page (needs a GitHub single-sign-on app, `AUTH_GITHUB_*`) and who belong to the project's organization. To block merging, mark the check as required in the repository's branch protection. With a project linked to a repository, the check is the merge gate: `circi upload --wait` waits for processing, exits 0 even with unreviewed changes (so a green CI job isn't confused with a visual review), and fails only on processing errors. Approving on GitHub or in the dashboard updates the check within seconds, no re-run needed. Without a linked repository the CI job is the gate (exit 1 until approved, then re-run). The first build of a project has nothing to compare with, so every screenshot is new and waits for review (there is no neutral state); not even on the default branch: automatic approval of default-branch builds needs an approved baseline to compare with, so someone approves every screenshot once, and until then later builds have no baseline either. `--gate status|exit-code` overrides the choice.

## Hosting Storybook and reports

Set `STATIC_SITES_HOST` to a **separate, dedicated domain** and switch on *Host static sites* in a project's settings, then `circi storybook upload ./storybook-static` or `circi site upload ./report --name playwright`. Each upload gets a commit address and a branch address (`<hash>-<site>.<sites domain>`); opening one asks you to sign in, and only members of the project's organization get in. See [docs/static-sites.md](docs/static-sites.md) for how it works, the **⚠️ domain and cookie rules you must check**, Route53/Caddy setup (`deploy/`), and what isn't built yet. `circi admin doctor` checks what it can.

## CI examples, Vitest and Argos

[docs/ci-examples.md](docs/ci-examples.md) (GitHub Actions, GitLab CI, Bitbucket Pipelines, Gitea, Jenkins, sharded runs), [docs/vitest.md](docs/vitest.md) (`@circi/vitest`) and [docs/argos-migration.md](docs/argos-migration.md) (point the Argos SDKs at `/v2`).

## Self-hosting (Docker)

```sh
cd deploy
cp .env.example .env        # set POSTGRES_PASSWORD, PUBLIC_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --build

# Open PUBLIC_URL: a fresh install shows a setup page that creates the first account (an
# instance admin) and its organization. It asks for a setup code, printed in the server log
# (docker compose logs circi) or by:
docker compose exec circi circi admin setup-code
# Then create projects in the dashboard (their CI token is shown once).
#
# Everything also works from the command line, e.g.:
#   circi admin user create --email you@acme.io --name "You"
#   circi admin org create --name "Acme" --owner you@acme.io
#   circi admin project create --org acme --name "Web app"
```

With SMTP configured, people with an account can also sign in with a 6-digit code mailed to them (the mail also holds a link that fills the code in). Codes work once, expire after 10 minutes, are stored hashed, lock after 5 wrong attempts, and addresses without an account get the same answer and no mail.

Code requests are limited per address (5 per 15 minutes, across all IPs, whether or not the address has an account), and with SMTP configured people get a "new sign-in" mail when their account signs in from a browser it hasn't been used from before.

Owners and admins can also invite people by email from the organization's members page (click the organization name in the header). Invited people without an account create it by signing in with an emailed code.

Each project's **Settings** page (owners and admins) sets the default branch, a diff threshold, retention, whether builds on the default branch are approved automatically (once there is a baseline), whether unreviewed changes block merging, and whether a change to **flaky screenshots only** blocks merging. A flaky screenshot is one that changed in 3 or more of the last 10 default-branch builds. The organization's members page (owners and admins) sets the default for all its projects, **Flaky screenshots block merges**, on by default; each project can follow it ("Inherit from organization") or set its own on or off. With it off, a pull request whose only changes are flaky screenshots passes the gate (the check is green, `--wait` reports a pass), while the build still lists them as flaky and shows the other changes as usual. A new, removed or unreadable screenshot, or a change to a steady one, still needs review. The account menu has **Account and sessions**, to see every device signed in as you and sign any of them out.

Owners and admins can restrict which sign-in methods an organization accepts (password, email code) on the members page. The organization's projects are then only shown to sessions that signed in with an accepted method, and the page refuses a change that would leave no owner able to sign in. If a setting ever locks everyone out, `circi admin auth enable password --org acme` (or `email`) on the server undoes it.

Owners and admins can also claim email domains on the members page. After adding a DNS TXT record (`_circi-verify.example.com`) to prove the domain is theirs, anyone who signs in with an emailed code on an address at that domain joins the organization as a member, with no invitation (people with no account yet get one). A domain can be verified by one organization only.

### Single sign-on

Set `AUTH_GITHUB_CLIENT_ID`/`_SECRET`, `AUTH_GOOGLE_CLIENT_ID`/`_SECRET`, or `AUTH_OIDC_ISSUER`/`_CLIENT_ID`/`_CLIENT_SECRET` (+ `AUTH_OIDC_NAME` for the button label) for any OpenID Connect provider, and the sign-in page gets a button for each. Register `PUBLIC_URL/api/auth/callback/<github|google|oidc>` as the redirect URI at the provider. A provider login never creates an account by itself: the person must have been invited, or the provider must be trusted for email and the address be on a verified organization domain. It attaches to an existing account with the same email only if the provider is trusted: GitHub and Google are, a generic provider is not unless you set `AUTH_OIDC_TRUSTED_FOR_EMAIL=true` (only do that if the provider verifies every address it reports).

Owners and admins can also connect the organization's **own** OpenID Connect provider (Okta, Entra ID, Keycloak…) on the members page. People then use "Sign in through your organization" on the sign-in page. Such a provider is trusted for its own organization only: the people it signs in join as members and their session opens that organization and nothing else, an address that already has an account is refused rather than linked, and its claims about email addresses are never trusted. The issuer must be a public https address (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES` also lifts that for private networks).

Anyone you add to an organization sees its projects, builds and screenshots, and nothing else. Add people with `circi admin user create` and `circi admin member add`.

- Storage defaults to local disk (a Docker volume), the cheapest option. For S3-compatible storage, set `STORAGE_DRIVER=s3` and the `S3_*` variables. `docker-compose.s3.yml` adds a local MinIO for development.
- `GET /healthz` is liveness; `GET /readyz` checks the database and storage.

### Server commands

| Command | What it does |
|---|---|
| `circi all` | HTTP server and worker in one process (small installs) |
| `circi serve` / `circi worker` | Run them separately, to scale independently |
| `circi migrate` | Apply database migrations and exit (`serve`/`worker`/`all` also migrate on start unless `--no-migrate`) |
| `circi admin user create\|set-password` | Create accounts and reset passwords (generated passwords are printed once) |
| `circi admin org create\|list` | Manage organizations (`create` needs `--owner <email>`) |
| `circi admin member add` | Add an existing account to an organization (`--role owner\|admin\|member`) |
| `circi admin project create\|list\|rotate-token` | Manage projects and their CI tokens |
| `circi admin auth enable\|disable <email\|password> --org <slug>` | Change an organization's accepted sign-in methods (skips the lockout guard: break-glass) |
| `circi admin github link\|unlink` | Link a project to a GitHub repository (needs the GitHub App) |
| `circi admin storage usage\|gc` | What's stored, by kind; run retention now (expire old builds and sites, delete unused files) |
| `circi admin doctor` | Best-effort check of the domains' cookie scope and the sites domain |
| `circi admin setup-code` | Print the code the first-run setup page asks for |
| `circi admin mail test` | Send a test mail through the configured SMTP server |
| `circi admin webhook add\|list\|remove` | Send the chosen events of a project to a URL: `--events build.completed,build.reviewed` (at least one is required) |

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `PUBLIC_URL` | `http://localhost:3000` | Dashboard address: any host you own, e.g. `https://ci.acme.io`. Must be the root of its own hostname (no sub-path); use `https` outside local development |
| `PREVIOUS_PUBLIC_URLS` | | Comma-separated old dashboard addresses. Requests to them are redirected to `PUBLIC_URL`, so old links keep working after a move |
| `TRUSTED_PROXIES` | none | Reverse proxies whose `X-Forwarded-For` is believed: comma-separated IPs or CIDR ranges (e.g. `10.0.0.5,172.16.0.0/12`), or `true` for any hop (**unsafe**: anyone who can reach the app directly can forge their address). By default nobody is trusted and the client address is the socket's: forged headers can't dodge the sign-in rate limits. **Behind a reverse proxy, set it to the proxy's address**, or all users share the proxy's address and one rate limit |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | `fatal` … `trace` |
| `DATABASE_URL` and the worker | | The worker wakes on Postgres `LISTEN/NOTIFY`, so it needs a direct Postgres connection or session pooling, not a transaction pooler such as PgBouncer in transaction mode |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | Outgoing mail. `SMTP_FROM` is required with `SMTP_HOST`; port defaults to 587 (STARTTLS), 465 means implicit TLS. Check it with `circi admin mail test --to you@acme.io` |
| `AUTH_PASSWORD_ENABLED` | `true` | Email + password sign-in. `false` needs email login (SMTP) to be available, or nobody could sign in |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_API_URL` | | The GitHub App, see above |
| `STATIC_SITES_HOST`, `STATIC_SITES_MAX_MB` | | Static site hosting: a dedicated domain, and the largest site in MB (default 200) |
| `GC_GRACE_HOURS` | `24` | Files nothing uses any more are deleted after this long. Old builds and sites expire after the project's retention (days) |
| `UPLOAD_TIMEOUT_MINUTES` | `60` | Builds still uploading after this long fail, naming the missing shards; `0` never |
| `AUTH_SSO_ENABLED` | `true` | Set `false` to hide single sign-on even with providers configured |
| `AUTH_GITHUB_*`, `AUTH_GOOGLE_*`, `AUTH_OIDC_*` | | Single sign-on providers, see above |
| `AUTH_EMAIL_ENABLED` | `true` | Email sign-in codes; only offered when SMTP is configured. `false` turns them off |
| `ORG_CREATION` | `admin` | Who may create organizations in the dashboard: `admin` (instance admins) or `anyone` (every signed-in account) |
| `WEBHOOK_ALLOW_PRIVATE_ADDRESSES` | `false` | Allow webhooks to private/loopback addresses (they are refused by default) |
| `BETTER_AUTH_SECRET` | (required) | Signs sessions and cookies; 32+ characters (`openssl rand -base64 32`). Changing it signs everyone out |
| `STORAGE_DRIVER` | `fs` | `fs` (local disk) or `s3` |
| `STORAGE_PATH` | `/var/lib/circi/files` | For `fs` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | | For `s3`; endpoint for R2/B2/MinIO, omit for AWS |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Omit both to use the AWS credential chain (e.g. an IAM role) |
| `S3_CONNECT_TIMEOUT_SECONDS` | `10` | Give up connecting to S3 after this long, so a dropped connection cannot hang a request or job |
| `S3_REQUEST_TIMEOUT_SECONDS` | `60` | Give up when S3 sends or accepts nothing for this long (idle time, not total: big files keep flowing) |

## Development

Requires Node 26 (see `.nvmrc`) and pnpm 12.

```sh
nvm install && nvm use   # Node 26 from .nvmrc
pnpm install
pnpm exec playwright install chromium   # once: the component tests run in headless Chromium (Vitest browser mode)
pnpm test          # Vitest; database tests run on PGlite, so no Docker needed
pnpm typecheck
pnpm lint          # oxlint, including type-aware rules
pnpm format        # oxfmt (pnpm format:check in CI)
pnpm build         # tsdown (ui, cli, vitest, server bundle) and Vite (web) → */dist; the other packages run from source

# Run the server from source against your own Postgres:
DATABASE_URL=postgres://… BETTER_AUTH_SECRET=$(openssl rand -base64 32) STORAGE_PATH=./data pnpm circi all
```

- **Schema changes:** edit the table files in `packages/db/src/schema/`, then `pnpm db:generate` writes a new SQL migration to `packages/db/migrations/`. Commit both.
- **Auth tables** (`schema/auth.ts`) belong to better-auth and are generated, never edited by hand: after changing its plugins in `packages/auth/src/auth.ts`, run `pnpm db:auth-schema`, then `pnpm db:generate`.
- **Live S3 tests** run when `CIRCI_TEST_S3_ENDPOINT` is set (e.g. `http://localhost:9000` with the MinIO overlay); otherwise they're skipped.

### Layout

```
apps/server      circi command: HTTP routes (CI API, dashboard, sign-in), admin CLI, process lifecycle
apps/worker      background jobs: baseline, diffing, thumbnails, webhooks, git notifications
apps/web         the dashboard (React, TanStack Router/Query, Base UI design system with light and dark schemes), organised by feature
packages/api     the dashboard API's wire types, shared by the server and the web app
packages/auth    better-auth setup (plugins, hooks), admin operations
packages/cli     `circi upload` for CI
packages/config  environment parsing and validation
packages/core    shared logic: baselines, pairing, build outcomes, limits, slugs
packages/db      Drizzle schema, migrations, repositories, dashboard queries
packages/diff    PNG validation, pixel diffs, thumbnails
packages/providers  GitHub App client and what CirCI shows on a git host
packages/services  the service layer: build state changes with their jobs and notices, atomically
packages/storage local-disk and S3 drivers with checksum-verified writes
packages/testing PGlite test database and seeders
deploy/          Dockerfile and docker-compose files
```

See [CLAUDE.md](CLAUDE.md) for the layering rules and type conventions.
