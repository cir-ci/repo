# CirCI

Self-hosted visual regression testing: a cheaper alternative to Argos-CI. CI uploads screenshots, the server diffs them against a baseline, and reviewers approve or reject the changes.

**Status: M1 (first usable version).** CI uploads screenshots with `circi upload`, the worker diffs them against the right baseline, `--wait` fails the CI job when changes need review, and a password-protected dashboard shows the results. User accounts, approving in the UI and git host integrations come next (M2). See [PLAN.md](PLAN.md) for the full design and milestones.

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
cp .env.example .env        # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose up -d --build

docker compose exec circi circi admin org create --name "Acme"
docker compose exec circi circi admin project create --org acme --name "Web app"
# → prints the project's CI token once; store it as CIRCI_TOKEN in your CI secrets
```

- Storage defaults to local disk (a Docker volume), the cheapest option. For S3-compatible storage, set `STORAGE_DRIVER=s3` and the `S3_*` variables. `docker-compose.s3.yml` adds a local MinIO for development.
- `GET /healthz` is liveness; `GET /readyz` checks the database and storage.

### Server commands

| Command | What it does |
|---|---|
| `circi all` | HTTP server and worker in one process (small installs) |
| `circi serve` / `circi worker` | Run them separately, to scale independently |
| `circi migrate` | Apply database migrations and exit (`serve`/`worker`/`all` also migrate on start unless `--no-migrate`) |
| `circi admin org create\|list` | Manage organizations |
| `circi admin project create\|list\|rotate-token` | Manage projects and their CI tokens |

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `PUBLIC_URL` | `http://localhost:3000` | Dashboard address: any host you own, e.g. `https://ci.acme.io`. Must be the root of its own hostname (no sub-path); use `https` outside local development |
| `PREVIOUS_PUBLIC_URLS` | | Comma-separated old dashboard addresses. Requests to them are redirected to `PUBLIC_URL`, so old links keep working after a move |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | `fatal` … `trace` |
| `DASHBOARD_PASSWORD` | | Dashboard password (12+ characters, any username). Until user accounts arrive, the dashboard is off without it |
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
DATABASE_URL=postgres://… STORAGE_PATH=./data pnpm circi all
```

- **Schema changes:** edit `packages/db/src/schema.ts`, then `pnpm db:generate` writes a new SQL migration to `packages/db/migrations/`. Commit both.
- **Live S3 tests** run when `CIRCI_TEST_S3_ENDPOINT` is set (e.g. `http://localhost:9000` with the MinIO overlay); otherwise they're skipped.

### Layout

```
apps/server      circi command: HTTP server, admin commands, process lifecycle
apps/worker      background jobs (wired up; handlers arrive in M1)
packages/config  environment parsing and validation
packages/core    shared domain logic: slugs, CI tokens
packages/db      Drizzle schema, migrations, admin operations
packages/storage local-disk and S3 drivers with checksum-verified writes
deploy/          Dockerfile and docker-compose files
```
