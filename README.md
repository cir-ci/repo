# CirCI

Self-hosted visual regression testing: a cheaper alternative to Argos-CI. CI uploads screenshots, the server diffs them against a baseline, and reviewers approve or reject the changes.

**Status: M1 plus accounts.** CI uploads screenshots with `circi upload`, the worker diffs them against the right baseline, `--wait` fails the CI job when changes need review, and a dashboard shows the results to signed-in members of the organization. Accounts, organizations and CI tokens are handled by [better-auth](https://better-auth.com). Approving in the UI, email login, single sign-on and git host integrations come next (M2). See [PLAN.md](PLAN.md) for the full design and milestones.

## Uploading from CI

```sh
CIRCI_TOKEN=circi_… CIRCI_API_URL=https://ci.acme.io npx circi upload ./screenshots --wait
```

- Every `*.png` under the directory is a screenshot, named by its path (`settings/profile.png` → `settings/profile`). An optional `<file>.png.json` next to it adds metadata.
- Commit, branch and PR are read from the CI environment (GitHub Actions, GitLab, Bitbucket, Gitea/Forgejo, CircleCI, Buildkite, Jenkins, Azure Pipelines); `CIRCI_COMMIT`, `CIRCI_BRANCH`, `CIRCI_PR_NUMBER` and `CIRCI_BASE_BRANCH` override them.
- Shallow CI checkouts are fine: the CLI fetches the base branch and just enough history to find the right baseline.
- `--wait` exit codes: `0` pass, `1` visual changes need review (blocks the merge), `2` error.

## Self-hosting (Docker)

```sh
cd deploy
cp .env.example .env        # set POSTGRES_PASSWORD, PUBLIC_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --build

# There is no self sign-up: create the first account, an organization it owns, and a project.
docker compose exec circi circi admin user create --email you@acme.io --name "You"
# → prints a generated password once; sign in at PUBLIC_URL and change it
docker compose exec circi circi admin org create --name "Acme" --owner you@acme.io
docker compose exec circi circi admin project create --org acme --name "Web app"
# → prints the project's CI token once; store it as CIRCI_TOKEN in your CI secrets
```

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

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `PUBLIC_URL` | `http://localhost:3000` | Dashboard address: any host you own, e.g. `https://ci.acme.io`. Must be the root of its own hostname (no sub-path); use `https` outside local development |
| `PREVIOUS_PUBLIC_URLS` | | Comma-separated old dashboard addresses. Requests to them are redirected to `PUBLIC_URL`, so old links keep working after a move |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | `fatal` … `trace` |
| `BETTER_AUTH_SECRET` | (required) | Signs sessions and cookies; 32+ characters (`openssl rand -base64 32`). Changing it signs everyone out |
| `STORAGE_DRIVER` | `fs` | `fs` (local disk) or `s3` |
| `STORAGE_PATH` | `/var/lib/circi/files` | For `fs` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | | For `s3`; endpoint for R2/B2/MinIO, omit for AWS |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Omit both to use the AWS credential chain (e.g. an IAM role) |

## Development

Requires Node 26 (see `.nvmrc`) and pnpm 12.

```sh
nvm install && nvm use   # Node 26 from .nvmrc
pnpm install
pnpm test          # Vitest; database tests run on PGlite, so no Docker needed
pnpm typecheck
pnpm lint          # oxlint, including type-aware rules
pnpm format        # oxfmt (pnpm format:check in CI)
pnpm build         # tsc project build → */dist

# Run the server from source against your own Postgres:
DATABASE_URL=postgres://… BETTER_AUTH_SECRET=$(openssl rand -base64 32) STORAGE_PATH=./data pnpm circi all
```

- **Schema changes:** edit the table files in `packages/db/src/schema/`, then `pnpm db:generate` writes a new SQL migration to `packages/db/migrations/`. Commit both.
- **Auth tables** (`schema/auth.ts`) belong to better-auth and are generated, never edited by hand: after changing its plugins in `packages/auth/src/auth.ts`, run `pnpm db:auth-schema`, then `pnpm db:generate`.
- **Live S3 tests** run when `CIRCI_TEST_S3_ENDPOINT` is set (e.g. `http://localhost:9000` with the MinIO overlay); otherwise they're skipped.

### Layout

```
apps/server      circi command: HTTP routes (CI API, dashboard, sign-in), admin CLI, process lifecycle
apps/worker      background jobs: baseline, diffing, thumbnails
apps/web         the dashboard (React, TanStack Router/Query, MUI)
packages/auth    better-auth setup: accounts, organizations, CI tokens (API keys), admin operations
packages/cli     `circi upload` for CI
packages/config  environment parsing and validation
packages/core    shared logic: baselines, pairing, build outcomes, slugs
packages/db      Drizzle schema, migrations, repositories, dashboard queries
packages/diff    PNG validation, pixel diffs, thumbnails
packages/storage local-disk and S3 drivers with checksum-verified writes
deploy/          Dockerfile and docker-compose files
```
