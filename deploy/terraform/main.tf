# CirCI on a Docker host: the app (ghcr.io/cir-ci/circi:<circi_version>), Postgres unless database
# is given, and Caddy when caddy is set. The same services as deploy/docker-compose.yml (+ the Caddy
# overlay), managed by Terraform. Changing circi_version pulls that image and replaces the container.

locals {
  bundled_postgres = var.database == null
  caddy_address    = cidrhost(var.network_subnet, 10)
  secrets_dir      = "/run/circi/secrets"
  database_ca_path = "/run/circi/database-ca.pem"

  database_ca = try(var.database.ca_certificate, null)

  # The bundled Postgres, or yours.
  bundled_db = {
    host     = "postgres"
    port     = 5432
    name     = "circi"
    user     = "circi"
    password = var.postgres_password
    query    = ""
  }
  db = local.bundled_postgres ? local.bundled_db : {
    host     = var.database.host
    port     = tonumber(coalesce(try(var.database.port, null), 5432))
    name     = coalesce(try(var.database.name, null), "circi")
    user     = var.database.user
    password = var.database_password
    query = try(var.database.tls, null) == false ? "?sslmode=disable" : (
      "?sslmode=verify-full${local.database_ca == null ? "" : "&sslrootcert=${local.database_ca_path}"}"
    )
  }
  # URL-encoded: urlencode writes a space as +, which a URL's user part reads as a plus sign.
  encoded = { for name in ["user", "password", "name"] : name => replace(
    urlencode(local.db[name] == null ? "" : local.db[name]), "+", "%20",
  ) }
  database_url = format(
    "postgres://%s:%s@%s:%d/%s%s",
    local.encoded.user, local.encoded.password, local.db.host, local.db.port, local.encoded.name, local.db.query,
  )

  public_url = var.caddy == null ? var.public_url : "https://${var.caddy.dashboard_host}"

  # Every setting the server reads, by name (packages/config/src/schema.ts), from its group's key. The
  # image sets NODE_ENV, HOST, PORT, STORAGE_PATH, CIRCI_MIGRATIONS and CIRCI_WEB_DIST: the port, the
  # volume and the files below depend on them, so they are not inputs. A null value is left unset.
  settings = {
    PUBLIC_URL                      = local.public_url
    PREVIOUS_PUBLIC_URLS            = length(var.previous_public_urls) == 0 ? null : join(",", var.previous_public_urls)
    TRUSTED_PROXIES                 = var.caddy != null ? local.caddy_address : length(var.trusted_proxies) == 0 ? null : join(",", var.trusted_proxies)
    LOG_LEVEL                       = var.log_level
    WORKSPACE_CREATION              = var.workspace_creation
    STORAGE_DRIVER                  = var.s3 == null ? null : "s3"
    S3_BUCKET                       = try(var.s3.bucket, null)
    S3_REGION                       = try(var.s3.region, null)
    S3_ENDPOINT                     = try(var.s3.endpoint, null)
    S3_FORCE_PATH_STYLE             = try(var.s3.force_path_style, null)
    S3_ACCESS_KEY_ID                = try(var.s3.access_key_id, null)
    S3_CONNECT_TIMEOUT_SECONDS      = try(var.s3.connect_timeout_seconds, null)
    S3_REQUEST_TIMEOUT_SECONDS      = try(var.s3.request_timeout_seconds, null)
    SMTP_HOST                       = try(var.smtp.host, null)
    SMTP_PORT                       = try(var.smtp.port, null)
    SMTP_SECURE                     = try(var.smtp.secure, null)
    SMTP_USER                       = try(var.smtp.user, null)
    SMTP_FROM                       = try(var.smtp.from, null)
    AUTH_EMAIL_ENABLED              = try(var.sign_in.email, null)
    AUTH_PASSWORD_ENABLED           = try(var.sign_in.password, null)
    AUTH_SSO_ENABLED                = try(var.sign_in.sso, null)
    AUTH_GITHUB_CLIENT_ID           = try(var.sso.github_client_id, null)
    AUTH_GOOGLE_CLIENT_ID           = try(var.sso.google_client_id, null)
    AUTH_GITLAB_CLIENT_ID           = try(var.sso.gitlab_client_id, null)
    AUTH_GITLAB_URL                 = try(var.sso.gitlab_url, null)
    AUTH_OIDC_ISSUER                = try(var.sso.oidc_issuer, null)
    AUTH_OIDC_CLIENT_ID             = try(var.sso.oidc_client_id, null)
    AUTH_OIDC_NAME                  = try(var.sso.oidc_name, null)
    AUTH_OIDC_TRUSTED_FOR_EMAIL     = try(var.sso.oidc_trusted_for_email, null)
    GITHUB_APP_ID                   = try(var.github_app.id, null)
    GITHUB_API_URL                  = try(var.github_app.api_url, null)
    GITHUB_API_TIMEOUT_SECONDS      = try(var.github_app.api_timeout_seconds, null)
    SLACK_CLIENT_ID                 = try(var.slack.client_id, null)
    SLACK_API_URL                   = try(var.slack.api_url, null)
    VAPID_PUBLIC_KEY                = try(var.vapid.public_key, null)
    VAPID_SUBJECT                   = try(var.vapid.subject, null)
    STATIC_SITES_HOST               = var.caddy != null ? var.caddy.sites_host : try(var.sites.host, null)
    STATIC_SITES_MAX_MB             = try(var.sites.max_mb, null)
    UPLOAD_TIMEOUT_MINUTES          = try(var.jobs.upload_timeout_minutes, null)
    GC_GRACE_HOURS                  = try(var.jobs.gc_grace_hours, null)
    JOB_RETENTION_DAYS              = try(var.jobs.retention_days, null)
    JOB_RETRY_BASE_SECONDS          = try(var.jobs.retry_base_seconds, null)
    JOB_RETRY_MAX_SECONDS           = try(var.jobs.retry_max_seconds, null)
    WEBHOOK_TIMEOUT_SECONDS         = try(var.webhooks.timeout_seconds, null)
    WEBHOOK_ALLOW_PRIVATE_ADDRESSES = try(var.webhooks.allow_private_addresses, null)
    DATABASE_POOL_MAX               = try(var.tuning.database_pool_max, null)
    CIRCI_DIFF_ENGINE               = try(var.tuning.diff_engine, null)
    CIRCI_DIFF_THREADS              = try(var.tuning.diff_threads, null)
    LIVE_MAX_STREAMS                = try(var.tuning.live_max_streams, null)
  }

  # Secrets go into the container as files, named by <NAME>_FILE, so the environment above stays
  # readable in plan output. Which ones are set isn't secret, only their values.
  secrets = {
    BETTER_AUTH_SECRET        = var.better_auth_secret
    DATABASE_URL              = local.database_url
    S3_SECRET_ACCESS_KEY      = var.s3_secret_access_key
    SMTP_PASSWORD             = var.smtp_password
    AUTH_GITHUB_CLIENT_SECRET = var.auth_github_client_secret
    AUTH_GOOGLE_CLIENT_SECRET = var.auth_google_client_secret
    AUTH_GITLAB_CLIENT_SECRET = var.auth_gitlab_client_secret
    AUTH_OIDC_CLIENT_SECRET   = var.auth_oidc_client_secret
    GITHUB_APP_PRIVATE_KEY    = var.github_app_private_key
    GITHUB_APP_WEBHOOK_SECRET = var.github_app_webhook_secret
    SLACK_CLIENT_SECRET       = var.slack_client_secret
    VAPID_PRIVATE_KEY         = var.vapid_private_key
  }
  caddy_aws_keys = nonsensitive(var.caddy_aws_credentials != null)
  secret_names   = toset(nonsensitive([for name, value in local.secrets : name if value != null]))

  environment = concat(
    [for name, value in local.settings : "${name}=${tostring(value)}" if value != null],
    [for name in local.secret_names : "${name}_FILE=${local.secrets_dir}/${name}"],
  )

  # Settings that go together: all set, or none (SETTING_GROUPS in packages/config/src/settings.ts,
  # which the server checks too, but only once the container starts).
  setting_groups = [
    ["SMTP_USER", "SMTP_PASSWORD"],
    ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"],
    ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    ["AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET"],
    ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"],
    ["AUTH_GITLAB_CLIENT_ID", "AUTH_GITLAB_CLIENT_SECRET"],
    ["AUTH_OIDC_ISSUER", "AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET"],
  ]
  every_setting = merge(local.settings, local.secrets)
  half_set_groups = nonsensitive([
    for group in local.setting_groups : join(" / ", group)
    if length(distinct([for name in group : local.every_setting[name] != null])) > 1
  ])
}

resource "docker_network" "circi" {
  name = var.name_prefix
  ipam_config {
    subnet = var.network_subnet
    # Docker picks this address itself; named here, or the provider reads it as a change and
    # replaces the network (and every container on it) on each apply.
    gateway = cidrhost(var.network_subnet, 1)
  }
}

resource "docker_volume" "files" {
  name = "${var.name_prefix}-files"
  lifecycle {
    prevent_destroy = true
  }
}

# --- Postgres -----------------------------------------------------------------------------------

resource "docker_volume" "pgdata" {
  count = local.bundled_postgres ? 1 : 0
  name  = "${var.name_prefix}-pgdata"
  lifecycle {
    prevent_destroy = true
  }
}

resource "docker_image" "postgres" {
  count        = local.bundled_postgres ? 1 : 0
  name         = var.postgres_image
  keep_locally = true
}

resource "docker_container" "postgres" {
  count   = local.bundled_postgres ? 1 : 0
  name    = "${var.name_prefix}-postgres"
  image   = docker_image.postgres[0].image_id
  restart = "unless-stopped"
  env = [
    "POSTGRES_USER=circi",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=circi",
  ]
  networks_advanced {
    name    = docker_network.circi.id
    aliases = ["postgres"]
  }
  # Postgres 18 images keep their data under /var/lib/postgresql/<major>/.
  volumes {
    volume_name    = docker_volume.pgdata[0].name
    container_path = "/var/lib/postgresql"
  }
  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U circi -d circi"]
    interval = "5s"
    timeout  = "3s"
    retries  = 20
  }
  wait = true

  lifecycle {
    # POSTGRES_PASSWORD only counts when the volume is first made: a new one is set with ALTER USER,
    # and replacing this container for it would change nothing but the downtime.
    ignore_changes = [env]
    precondition {
      condition     = var.postgres_password != null
      error_message = "Set postgres_password for the bundled Postgres, or database for your own."
    }
  }
}

# --- CirCI --------------------------------------------------------------------------------------

resource "docker_image" "circi" {
  name         = "${var.image_repository}:${var.circi_version}"
  keep_locally = true
}

resource "docker_container" "circi" {
  name    = var.name_prefix
  image   = docker_image.circi.image_id
  command = ["all"]
  restart = "unless-stopped"
  env     = local.environment

  dynamic "upload" {
    for_each = local.secret_names
    content {
      file    = "${local.secrets_dir}/${upload.value}"
      content = local.secrets[upload.value]
    }
  }
  dynamic "upload" {
    for_each = local.database_ca == null ? [] : [local.database_ca]
    content {
      file    = local.database_ca_path
      content = upload.value
    }
  }

  networks_advanced {
    name    = docker_network.circi.id
    aliases = ["circi"] # the Caddyfile proxies to circi:3000
  }
  volumes {
    volume_name    = docker_volume.files.name
    container_path = "/var/lib/circi/files"
  }
  dynamic "ports" {
    for_each = var.caddy == null ? [var.port] : []
    content {
      internal = 3000
      external = ports.value
    }
  }

  # Apply waits for the image's own health check (/healthz), so a version that doesn't start fails
  # the apply instead of leaving a restarting container.
  wait         = true
  wait_timeout = 180

  depends_on = [docker_container.postgres]

  lifecycle {
    # The server checks these too, but only once the container starts: here they fail the plan.
    precondition {
      condition     = local.bundled_postgres || var.database_password != null
      error_message = "Set database_password with database."
    }
    precondition {
      condition     = length(local.half_set_groups) == 0
      error_message = "These settings go together, set all of each or none: ${join("; ", local.half_set_groups)}. (A secret's variable is its name in lower case, e.g. smtp_password; the others are keys of their group, e.g. smtp.user.)"
    }
    precondition {
      condition     = try(var.smtp.host, null) == null || try(var.smtp.from, null) != null
      error_message = "smtp.from is required with smtp.host."
    }
    precondition {
      condition     = var.s3 == null || try(var.s3.bucket, null) != null
      error_message = "s3 needs a bucket."
    }
    precondition {
      condition     = var.caddy == null || (try(var.sites.host, null) == null && length(var.trusted_proxies) == 0)
      error_message = "With caddy, sites.host is caddy.sites_host and trusted_proxies is Caddy's address: leave both unset."
    }
  }
}

# --- Caddy --------------------------------------------------------------------------------------

resource "docker_volume" "caddy_data" {
  count = var.caddy == null ? 0 : 1
  name  = "${var.name_prefix}-caddy-data"
}

resource "docker_volume" "caddy_config" {
  count = var.caddy == null ? 0 : 1
  name  = "${var.name_prefix}-caddy-config"
}

resource "docker_image" "caddy" {
  count        = var.caddy == null ? 0 : 1
  name         = "${var.image_repository}-caddy:${var.circi_version}"
  keep_locally = true
}

resource "docker_container" "caddy" {
  count   = var.caddy == null ? 0 : 1
  name    = "${var.name_prefix}-caddy"
  image   = docker_image.caddy[0].image_id
  restart = "unless-stopped"
  env = concat(
    [
      "DASHBOARD_HOST=${var.caddy.dashboard_host}",
      "SITES_HOST=${var.caddy.sites_host}",
      "AWS_REGION=${coalesce(try(var.caddy.aws_region, null), "us-east-1")}",
    ],
    local.caddy_aws_keys ? ["AWS_SHARED_CREDENTIALS_FILE=/run/caddy/aws-credentials"] : [],
  )
  # Route53 keys as a file too (the AWS SDK in Caddy reads a shared credentials file), so they stay
  # out of the container's environment and the plan.
  dynamic "upload" {
    for_each = local.caddy_aws_keys ? ["credentials"] : []
    content {
      file    = "/run/caddy/aws-credentials"
      content = <<-EOT
        [default]
        aws_access_key_id = ${var.caddy_aws_credentials.access_key_id}
        aws_secret_access_key = ${var.caddy_aws_credentials.secret_access_key}
      EOT
    }
  }
  networks_advanced {
    name         = docker_network.circi.id
    ipv4_address = local.caddy_address # the one proxy the app trusts (TRUSTED_PROXIES)
  }
  upload {
    file    = "/etc/caddy/Caddyfile"
    content = file("${path.module}/../Caddyfile")
  }
  volumes {
    volume_name    = docker_volume.caddy_data[0].name
    container_path = "/data"
  }
  volumes {
    volume_name    = docker_volume.caddy_config[0].name
    container_path = "/config"
  }
  ports {
    internal = 80
    external = 80
  }
  ports {
    internal = 443
    external = 443
  }
  ports {
    internal = 443
    external = 443
    protocol = "udp"
  }

  depends_on = [docker_container.circi]
}
