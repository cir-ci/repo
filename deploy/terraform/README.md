# CirCI on a Docker host, with Terraform

Runs a released CirCI on one Docker host: the app (`ghcr.io/cir-ci/circi:<version>`), Postgres in a container
(unless you give `database_url`), and Caddy for TLS and hosted sites (when `caddy` is set). The same services as
`deploy/docker-compose.yml` with the Caddy overlay, managed by Terraform.

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

  environment = {
    SMTP_HOST = "email-smtp.eu-west-1.amazonaws.com"
    SMTP_FROM = "CirCI <ci@acme.io>"
  }
  secrets = {
    SMTP_USER     = var.smtp_user
    SMTP_PASSWORD = var.smtp_password
  }
}
```

Without `caddy`, the app is published on `port` (3000) and `public_url` is its address; put your own proxy in front
and set `TRUSTED_PROXIES` in `environment`. Every setting in `deploy/.env.example` goes in `environment`, or in
`secrets` when it's secret (both end up in the container's environment; `secrets` stays out of plan output).

The volumes for screenshots and the bundled Postgres have `prevent_destroy`: a `terraform destroy` stops at them
instead of deleting your data.

## Inputs

| Name | Default | |
| --- | --- | --- |
| `circi_version` | (required) | The release to run, e.g. `0.1.0`. |
| `better_auth_secret` | (required) | `BETTER_AUTH_SECRET`. |
| `postgres_password` | `null` | For the bundled Postgres; required unless `database_url` is set. |
| `database_url` | `null` | Your own Postgres instead of the bundled one. |
| `public_url` | `http://localhost:3000` | Ignored with `caddy` (it becomes `https://<dashboard_host>`). |
| `caddy` | `null` | `dashboard_host`, `sites_host`, and optionally `aws_region`, `aws_access_key_id`, `aws_secret_access_key` (Route53, for the sites wildcard certificate; an instance role needs none), `trusted_proxies`. |
| `environment`, `secrets` | `{}` | Other settings (`deploy/.env.example`). |
| `port` | `3000` | Host port without `caddy`. |
| `image_repository` | `ghcr.io/cir-ci/circi` | Another registry or a mirror; the Caddy image is `<repository>-caddy`. |
| `postgres_image` | `postgres:18-alpine` | Keep the major: a new one needs a dump and restore. |
| `name_prefix` | `circi` | Containers, volumes and network names, for two installs on one host. |

Outputs: `version`, `image`, `public_url`.
