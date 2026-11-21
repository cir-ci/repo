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
    port     = var.database.port
    name     = var.database.name
    user     = var.database.user
    password = var.database_password
    query = !var.database.tls ? "?sslmode=disable" : (
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

  # Every setting the server reads, by name (packages/config/src/schema.ts). The image sets NODE_ENV,
  # HOST, PORT, STORAGE_PATH, CIRCI_MIGRATIONS and CIRCI_WEB_DIST: the port, the volume and the
  # files below depend on them, so they are not inputs. A null value is left unset.
  settings = {
    PUBLIC_URL                      = local.public_url
    PREVIOUS_PUBLIC_URLS            = length(var.previous_public_urls) == 0 ? null : join(",", var.previous_public_urls)
    TRUSTED_PROXIES                 = var.caddy != null ? local.caddy_address : length(var.trusted_proxies) == 0 ? null : join(",", var.trusted_proxies)
    STATIC_SITES_HOST               = var.caddy != null ? var.caddy.sites_host : var.static_sites_host
    LOG_LEVEL                       = var.log_level
    DATABASE_POOL_MAX               = var.database_pool_max
    STORAGE_DRIVER                  = var.s3_bucket == null ? null : "s3"
    S3_BUCKET                       = var.s3_bucket
    S3_REGION                       = var.s3_region
    S3_ENDPOINT                     = var.s3_endpoint
    S3_FORCE_PATH_STYLE             = var.s3_force_path_style
    S3_ACCESS_KEY_ID                = var.s3_access_key_id
    S3_CONNECT_TIMEOUT_SECONDS      = var.s3_connect_timeout_seconds
    S3_REQUEST_TIMEOUT_SECONDS      = var.s3_request_timeout_seconds
    SMTP_HOST                       = var.smtp_host
    SMTP_PORT                       = var.smtp_port
    SMTP_SECURE                     = var.smtp_secure
    SMTP_USER                       = var.smtp_user
    SMTP_FROM                       = var.smtp_from
    AUTH_EMAIL_ENABLED              = var.auth_email_enabled
    AUTH_PASSWORD_ENABLED           = var.auth_password_enabled
    AUTH_SSO_ENABLED                = var.auth_sso_enabled
    AUTH_GITHUB_CLIENT_ID           = var.auth_github_client_id
    AUTH_GOOGLE_CLIENT_ID           = var.auth_google_client_id
    AUTH_GITLAB_CLIENT_ID           = var.auth_gitlab_client_id
    AUTH_GITLAB_URL                 = var.auth_gitlab_url
    AUTH_OIDC_ISSUER                = var.auth_oidc_issuer
    AUTH_OIDC_CLIENT_ID             = var.auth_oidc_client_id
    AUTH_OIDC_NAME                  = var.auth_oidc_name
    AUTH_OIDC_TRUSTED_FOR_EMAIL     = var.auth_oidc_trusted_for_email
    WORKSPACE_CREATION              = var.workspace_creation
    GITHUB_APP_ID                   = var.github_app_id
    GITHUB_API_URL                  = var.github_api_url
    GITHUB_API_TIMEOUT_SECONDS      = var.github_api_timeout_seconds
    SLACK_CLIENT_ID                 = var.slack_client_id
    SLACK_API_URL                   = var.slack_api_url
    VAPID_PUBLIC_KEY                = var.vapid_public_key
    VAPID_SUBJECT                   = var.vapid_subject
    STATIC_SITES_MAX_MB             = var.static_sites_max_mb
    UPLOAD_TIMEOUT_MINUTES          = var.upload_timeout_minutes
    GC_GRACE_HOURS                  = var.gc_grace_hours
    JOB_RETENTION_DAYS              = var.job_retention_days
    JOB_RETRY_BASE_SECONDS          = var.job_retry_base_seconds
    JOB_RETRY_MAX_SECONDS           = var.job_retry_max_seconds
    WEBHOOK_TIMEOUT_SECONDS         = var.webhook_timeout_seconds
    WEBHOOK_ALLOW_PRIVATE_ADDRESSES = var.webhook_allow_private_addresses
    LIVE_MAX_STREAMS                = var.live_max_streams
    CIRCI_DIFF_ENGINE               = var.diff_engine
    CIRCI_DIFF_THREADS              = var.diff_threads
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
      condition     = (var.smtp_user == null) == (var.smtp_password == null)
      error_message = "Set smtp_user and smtp_password together, or neither for a server without login."
    }
    precondition {
      condition     = var.smtp_host == null || var.smtp_from != null
      error_message = "smtp_from is required with smtp_host."
    }
    precondition {
      condition     = (var.s3_access_key_id == null) == (var.s3_secret_access_key == null)
      error_message = "Set s3_access_key_id and s3_secret_access_key together, or neither to use the host's instance role."
    }
    precondition {
      condition     = var.s3_bucket != null || alltrue([for v in [var.s3_region, var.s3_endpoint, var.s3_force_path_style, var.s3_access_key_id] : v == null])
      error_message = "The s3_* settings need s3_bucket."
    }
    precondition {
      condition     = length(distinct([var.github_app_id != null, var.github_app_private_key != null, var.github_app_webhook_secret != null])) == 1
      error_message = "Set github_app_id, github_app_private_key and github_app_webhook_secret together."
    }
    precondition {
      condition     = length(distinct([var.auth_oidc_issuer != null, var.auth_oidc_client_id != null, var.auth_oidc_client_secret != null])) == 1
      error_message = "Set auth_oidc_issuer, auth_oidc_client_id and auth_oidc_client_secret together."
    }
    precondition {
      condition = alltrue([
        (var.auth_github_client_id == null) == (var.auth_github_client_secret == null),
        (var.auth_google_client_id == null) == (var.auth_google_client_secret == null),
        (var.auth_gitlab_client_id == null) == (var.auth_gitlab_client_secret == null),
        (var.slack_client_id == null) == (var.slack_client_secret == null),
        (var.vapid_public_key == null) == (var.vapid_private_key == null),
      ])
      error_message = "Set each client ID with its secret (auth_github_*, auth_google_*, auth_gitlab_*, slack_*) and vapid_public_key with vapid_private_key, or neither."
    }
    precondition {
      condition     = var.caddy == null || (var.static_sites_host == null && length(var.trusted_proxies) == 0)
      error_message = "With caddy, static_sites_host is caddy.sites_host and trusted_proxies is Caddy's address: leave both unset."
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
      "AWS_REGION=${var.caddy.aws_region}",
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
