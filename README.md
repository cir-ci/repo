# Zopheros

Self-hosted visual regression testing: a cheaper alternative to Argos-CI. CI uploads screenshots, the server diffs them against a baseline, and reviewers approve or reject the changes.

**Status: M0 (foundations).** The server runs, applies its database schema, and can create organizations, projects and CI tokens. Uploading, diffing and the review UI arrive in M1. See [PLAN.md](PLAN.md) for the full design and milestones.

## Self-hosting (Docker)

```sh
cd deploy
cp .env.example .env        # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose up -d --build

docker compose exec zopheros zopheros admin org create --name "Acme"
docker compose exec zopheros zopheros admin project create --org acme --name "Web app"
# → prints the project's CI token once; store it as ZOPHEROS_TOKEN in your CI secrets
```

- Storage defaults to local disk (a Docker volume), the cheapest option. For S3-compatible storage, set `STORAGE_DRIVER=s3` and the `S3_*` variables. `docker-compose.s3.yml` adds a local MinIO for development.
- `GET /healthz` is liveness; `GET /readyz` checks the database and storage.

### Server commands

| Command | What it does |
|---|---|
| `zopheros all` | HTTP server and worker in one process (small installs) |
| `zopheros serve` / `zopheros worker` | Run them separately, to scale independently |
| `zopheros migrate` | Apply database migrations and exit (`serve`/`worker`/`all` also migrate on start unless `--no-migrate`) |
| `zopheros admin org create\|list` | Manage organizations |
| `zopheros admin project create\|list\|rotate-token` | Manage projects and their CI tokens |

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `PUBLIC_URL` | `http://localhost:3000` | Dashboard address, e.g. `https://zop.example.com` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | `fatal` … `trace` |
| `STORAGE_DRIVER` | `fs` | `fs` (local disk) or `s3` |
| `STORAGE_PATH` | `/var/lib/zopheros/files` | For `fs` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | | For `s3`; endpoint for R2/B2/MinIO, omit for AWS |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Omit both to use the AWS credential chain (e.g. an IAM role) |

## Development

Requires Node 24 and pnpm 12.

```sh
pnpm install
pnpm test          # Vitest; database tests run on PGlite, so no Docker needed
pnpm typecheck
pnpm lint          # Biome (pnpm format to fix)
pnpm build         # tsc project build → */dist

# Run the server from source against your own Postgres:
DATABASE_URL=postgres://… STORAGE_PATH=./data pnpm zopheros all
```

- **Schema changes:** edit `packages/db/src/schema.ts`, then `pnpm db:generate` writes a new SQL migration to `packages/db/migrations/`. Commit both.
- **Live S3 tests** run when `ZOPHEROS_TEST_S3_ENDPOINT` is set (e.g. `http://localhost:9000` with the MinIO overlay); otherwise they're skipped.

### Layout

```
apps/server      zopheros command: HTTP server, admin commands, process lifecycle
apps/worker      background jobs (wired up; handlers arrive in M1)
packages/config  environment parsing and validation
packages/core    shared domain logic: slugs, CI tokens
packages/db      Drizzle schema, migrations, admin operations
packages/storage local-disk and S3 drivers with checksum-verified writes
deploy/          Dockerfile and docker-compose files
```
