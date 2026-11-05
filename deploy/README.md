# Deploying CirCI

`docker compose up -d --build` runs the app and Postgres (see the top-level README). For TLS and hosted sites, add Caddy: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build`.

> ⚠️ **If you host sites, read [docs/static-sites.md](../docs/static-sites.md) first.** The sites domain must be a separate domain used for nothing else, and nothing on the dashboard's parent domain may set cookies for the whole domain: uploaded sites run arbitrary JavaScript. `circi admin doctor` checks what it can.

Files: `Dockerfile` (the app), `docker-compose.yml`, `docker-compose.s3.yml` (local MinIO), `docker-compose.caddy.yml` + `Caddyfile` + `caddy/Dockerfile` (TLS with Route53 DNS-01), `.env.example`.
