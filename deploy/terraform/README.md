# CirCI on a Docker host, with Terraform

Runs a released CirCI on one Docker host: the app (`ghcr.io/cir-ci/circi:<version>`), Postgres in a container
(unless you give `database`, e.g. Amazon RDS), and Caddy for TLS and hosted sites (when `caddy` is set). The same
services as `deploy/docker-compose.yml` with the Caddy overlay, managed by Terraform. Needs Terraform 1.8 or later.

## Updating

Change `circi_version` and apply. Terraform pulls that image and replaces the container; the server applies
database migrations as it starts, and the apply waits for its health check, so a version that doesn't start fails
the apply. `curl https://ci.acme.io/healthz` shows the version a server runs.

The versions are the app's releases: the GitHub releases named `@circi/server@<version>`, each with its changelog.
Pin the module to the same release with `?ref=`, so the module and the image always match.

## Use

```hcl
provider "docker" {
  host = "ssh://ubuntu@ci.acme.io" # or unix:///var/run/docker.sock on the host itself
}

module "circi" {
  source = "git::https://github.com/cir-ci/repo.git//deploy/terraform?ref=@circi/server@0.1.0"

  circi_version      = "0.1.0"
  better_auth_secret = var.better_auth_secret # openssl rand -base64 32; keep it stable
  postgres_password  = var.postgres_password

  caddy = {
    dashboard_host = "ci.acme.io"
    sites_host     = "acme-sites.com" # a domain used for nothing else: read docs/reference/static-sites.md
  }

  smtp = {
    host = "email-smtp.eu-west-1.amazonaws.com"
    from = "CirCI <ci@acme.io>"
    user = var.smtp_user
  }
  smtp_password = var.smtp_password
}
```

The server's settings come in groups, one variable per area, each key named after its setting: `smtp.host` is
`SMTP_HOST`, `tuning.diff_engine` is `CIRCI_DIFF_ENGINE`. `variables.tf` lists each group's keys with their types,
settings and defaults.

| Group | Keys |
| --- | --- |
| `smtp` | `host`, `port`, `secure`, `user`, `from` |
| `s3` | `bucket`, `region`, `endpoint`, `force_path_style`, `access_key_id`, `connect_timeout_seconds`, `request_timeout_seconds` |
| `sign_in` | `email`, `password`, `sso` (which methods are on) |
| `sso` | `github_client_id`, `google_client_id`, `gitlab_client_id`, `gitlab_url`, `oidc_issuer`, `oidc_client_id`, `oidc_name`, `oidc_trusted_for_email` |
| `github_app` | `id`, `api_url`, `api_timeout_seconds` |
| `slack` | `client_id`, `api_url` |
| `vapid` | `public_key`, `subject` |
| `sites` | `host` (without `caddy`), `max_mb` |
| `jobs` | `upload_timeout_minutes`, `gc_grace_hours`, `retention_days`, `retry_base_seconds`, `retry_max_seconds` |
| `webhooks` | `timeout_seconds`, `allow_private_addresses` |
| `tuning` | `database_pool_max`, `diff_engine`, `diff_threads`, `live_max_streams` |

`log_level` and `workspace_creation` are variables of their own.

- **A misspelled key fails the plan** (`smtp takes host, port, secure, user, from: hots isn't one.`), and so does a value
  of the wrong type. The groups are typed `any` and checked key by key for that: an object type would drop a
  misspelled key without a word.
- **Settings that go together are checked in the plan**: `smtp.user` with `smtp_password`, each client ID with its
  secret, the three GitHub App values, the three OIDC values. The message names the variables
  (`These settings go together, set all of each or none: smtp.user / smtp_password.`).
- **A key left out, or null, leaves the setting unset**: each group defaults to `{}`, and `main.tf` lists every key with
  its default (null, which keeps the setting out of the container's environment). The server's default applies, and the settings the dashboard
  can change (Instance > Settings: SMTP, sign-in methods, Slack, retention, timeouts) stay changeable there. Setting one
  here locks it in the dashboard.
- A change to any setting shows in the plan.

**Secrets** are variables of their own, named after the setting in lower case and marked `sensitive`:
`better_auth_secret`, `smtp_password`, `s3_secret_access_key`, `github_app_private_key`, `github_app_webhook_secret`,
`slack_client_secret`, `vapid_private_key` and the `auth_*_client_secret`s. They never go into the container's
environment: each is uploaded as a file under `/run/circi/secrets/` and named by `<NAME>_FILE`, which the server reads,
so the plan shows every other setting in plain text. They are in the Terraform state like everything else: keep the
state somewhere private.

Without `caddy`, the app is published on `port` (3000) and `public_url` is its address; put your own proxy in front
and list it in `trusted_proxies`. With `caddy`, the app trusts Caddy's address only (the 10th address of
`network_subnet`).

The volumes for screenshots and the bundled Postgres have `prevent_destroy`: a `terraform destroy` stops at them
instead of deleting your data.

## Your own Postgres (Amazon RDS)

```hcl
module "circi" {
  # ...
  database = {
    host           = aws_db_instance.circi.address
    user           = aws_db_instance.circi.username
    name           = "circi"
    ca_certificate = data.http.rds_ca.response_body # verify RDS's certificate
  }
  database_password = var.database_password
}

data "http" "rds_ca" {
  url = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
}
```

- **TLS**: on by default, with the certificate verified (`sslmode=verify-full`). RDS's certificates come from
  Amazon's own CA, which Node doesn't trust, so pass its bundle as `ca_certificate` (from the URL above, or a
  copy kept next to your configuration with `file()`). Without it the server fails to start with a certificate
  error (`self-signed certificate in certificate chain`, or `unable to verify the first certificate`). RDS for PostgreSQL 15 and later refuses connections without TLS.
- **Password**: any characters (the module URL-encodes it). IAM database authentication isn't supported. If the
  password is rotated (RDS managed master password, Secrets Manager rotation), apply again with the new one; the server
  can't connect until you do. A user of its own for CirCI, rather than the master user, avoids that.
- **Permissions**: the server runs its migrations at start, so its user must be able to create tables in the
  database's `public` schema: the database's owner, e.g. `CREATE DATABASE circi OWNER circi_app`. No extensions are
  needed; PostgreSQL 13 or later.
- **Connect directly** to the instance (or the cluster's writer endpoint), not through RDS Proxy or PgBouncer in
  transaction mode: the server LISTENs for live updates and holds session locks, which those break or pin.
- **Connections**: each server opens up to `tuning.database_pool_max` (10) plus a few of its own (live updates, locks).
  Check the instance's `max_connections` on the smallest classes.
- **Network**: the Docker host must reach the instance (the instance's security group allows 5432 from the host's).
  The module's Docker network uses `network_subnet` (`192.168.250.0/24`): keep it outside the VPC's CIDR range, or
  traffic to RDS goes into Docker instead. Docker's own default networks (172.17.0.0/16 and up) overlap an AWS default
  VPC (172.31.0.0/16), which is why the module doesn't let Docker choose.
- **An instance role** for S3 (`s3` without `access_key_id`) or Route53 (Caddy without `caddy_aws_credentials`): a container
  reaches the role through the instance metadata service only if the instance's hop limit is 2
  (`metadata_options { http_put_response_hop_limit = 2 }`).

## Inputs

The main ones; `variables.tf` describes every input.

| Name | Default | |
| --- | --- | --- |
| `circi_version` | (required) | The release to run, e.g. `0.1.0`. |
| `better_auth_secret` | (required) | `BETTER_AUTH_SECRET`, 32+ characters. |
| `postgres_password` | `null` | For the bundled Postgres; required unless `database` is set. Changing it later: `ALTER USER` first. |
| `database`, `database_password` | `null` | Your own Postgres (`host`, `user`; `port` 5432, `name` `circi`, `tls` true, `ca_certificate` null). |
| `public_url`, `previous_public_urls` | `http://localhost:3000`, `[]` | `public_url` is ignored with `caddy` (it becomes `https://<dashboard_host>`). |
| `caddy`, `caddy_aws_credentials` | `null` | `dashboard_host`, `sites_host`, `aws_region` (`us-east-1`); Route53 keys when there's no instance role. |
| `port`, `trusted_proxies` | `3000`, `[]` | Without `caddy`: the host port, and your proxy's addresses. |
| `smtp`, `s3`, `sign_in`, `sso`, `github_app`, `slack`, `vapid`, `sites`, `jobs`, `webhooks`, `tuning` | `{}` | The server's settings, by area (above); a key you don't give is `null`. |
| `log_level`, `workspace_creation` | `null` | |
| `smtp_password`, `s3_secret_access_key`, `github_app_private_key`, `github_app_webhook_secret`, `slack_client_secret`, `vapid_private_key`, `auth_*_client_secret` | `null` | The secrets, as files. |
| `network_subnet` | `192.168.250.0/24` | The Docker network; outside any range the host must reach. |
| `image_repository` | `ghcr.io/cir-ci/circi` | Another registry or a mirror; the Caddy image is `<repository>-caddy`. |
| `postgres_image` | `postgres:18-alpine` | Keep the major: a new one needs a dump and restore. |
| `name_prefix` | `circi` | Containers, volumes and network names, for two installs on one host. |

Outputs: `version`, `image`, `public_url`.

## Tests

`pnpm test:terraform` (`terraform test` in this folder; the CI job `terraform`) plans the module against a mocked
Docker provider, no Docker needed, and checks what reaches the containers: one case sets every variable and expects each
setting under its own name. `packages/config/test/deploy-settings.test.ts` (in `pnpm test`) holds the module to
`@circi/config`'s lists of settings (`src/settings.ts`): every setting passed, the secrets as files and marked
`sensitive`, the same groups of settings that go together, and every setting in that test case.
