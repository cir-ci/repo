# CirCI on a Docker host: the app (ghcr.io/cir-ci/circi:<circi_version>), Postgres unless database_url
# is given, and Caddy when caddy is set. The same services as deploy/docker-compose.yml (+ the Caddy
# overlay), managed by Terraform. Changing circi_version pulls that image and replaces the container.

locals {
  bundled_postgres = var.database_url == null
  database_url = local.bundled_postgres ? (
    "postgres://circi:${var.postgres_password}@postgres:5432/circi"
  ) : var.database_url

  public_url = var.caddy == null ? var.public_url : "https://${var.caddy.dashboard_host}"

  # Fixed settings first, so a key in environment or secrets can't silently replace them.
  environment = merge(var.environment, var.secrets, {
    DATABASE_URL       = local.database_url
    PUBLIC_URL         = local.public_url
    BETTER_AUTH_SECRET = var.better_auth_secret
    }, var.caddy == null ? {} : {
    # Caddy reaches the app over this network: believe the client address it forwards.
    TRUSTED_PROXIES   = var.caddy.trusted_proxies
    STATIC_SITES_HOST = var.caddy.sites_host
  })
}

resource "docker_network" "circi" {
  name = var.name_prefix
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
    precondition {
      condition     = var.postgres_password != null
      error_message = "Set postgres_password for the bundled Postgres, or database_url for your own."
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
  env     = [for key, value in local.environment : "${key}=${value}"]

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
    var.caddy.aws_access_key_id == null ? [] : [
      "AWS_ACCESS_KEY_ID=${var.caddy.aws_access_key_id}",
      "AWS_SECRET_ACCESS_KEY=${var.caddy.aws_secret_access_key}",
    ],
  )
  networks_advanced {
    name = docker_network.circi.id
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
