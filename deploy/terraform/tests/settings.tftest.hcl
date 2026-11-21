# terraform test (no Docker needed: the provider is mocked). Checks what reaches the containers.

mock_provider "docker" {}

variables {
  circi_version      = "1.2.3"
  better_auth_secret = "a-secret-that-is-at-least-32-characters-long"
  postgres_password  = "ab/Cd+e= f"
}

run "bundled_postgres_encodes_the_password" {
  command = plan

  assert {
    condition     = nonsensitive(local.database_url) == "postgres://circi:ab%2FCd%2Be%3D%20f@postgres:5432/circi"
    error_message = "The bundled Postgres's URL must encode the password: ${nonsensitive(local.database_url)}"
  }
  assert {
    condition     = contains(docker_container.circi.env, "DATABASE_URL_FILE=/run/circi/secrets/DATABASE_URL")
    error_message = "DATABASE_URL reaches the server as a file."
  }
  assert {
    condition     = length([for e in docker_container.circi.env : e if startswith(e, "BETTER_AUTH_SECRET=") || startswith(e, "DATABASE_URL=")]) == 0
    error_message = "No secret may sit in the environment."
  }
  assert {
    condition     = !issensitive(docker_container.circi.env)
    error_message = "The environment stays readable in plan output."
  }
  assert {
    condition     = length(docker_container.postgres) == 1
    error_message = "Without database, Postgres runs in a container."
  }
}

run "unset_settings_stay_unset" {
  command = plan

  assert {
    condition     = toset([for e in docker_container.circi.env : split("=", e)[0]]) == toset(["PUBLIC_URL", "BETTER_AUTH_SECRET_FILE", "DATABASE_URL_FILE"])
    error_message = "Only PUBLIC_URL and the two required secrets are set by default: ${join(", ", docker_container.circi.env)}"
  }
}

run "rds_with_its_certificate_bundle" {
  command = plan

  variables {
    postgres_password = null
    database = {
      host           = "circi.abc123.eu-west-1.rds.amazonaws.com"
      user           = "circi_app"
      ca_certificate = "-----BEGIN CERTIFICATE-----\nRDS\n-----END CERTIFICATE-----\n"
    }
    database_password = "p@ss:w/rd"
    database_pool_max = 20
  }

  assert {
    condition     = nonsensitive(local.database_url) == "postgres://circi_app:p%40ss%3Aw%2Frd@circi.abc123.eu-west-1.rds.amazonaws.com:5432/circi?sslmode=verify-full&sslrootcert=/run/circi/database-ca.pem"
    error_message = "RDS: verify-full against the uploaded bundle: ${nonsensitive(local.database_url)}"
  }
  assert {
    condition     = length(docker_container.postgres) == 0 && length(docker_volume.pgdata) == 0
    error_message = "With database, no Postgres container or volume."
  }
  assert {
    condition     = contains(docker_container.circi.env, "DATABASE_POOL_MAX=20")
    error_message = "database_pool_max reaches the server."
  }
}

run "database_without_tls" {
  command = plan

  variables {
    postgres_password = null
    database          = { host = "10.0.0.5", port = 6543, name = "ci", user = "ci", tls = false }
    database_password = "x"
  }

  assert {
    condition     = nonsensitive(local.database_url) == "postgres://ci:x@10.0.0.5:6543/ci?sslmode=disable"
    error_message = "tls = false: ${nonsensitive(local.database_url)}"
  }
}

run "database_needs_its_password" {
  command = plan

  variables {
    postgres_password = null
    database          = { host = "db", user = "ci" }
  }

  expect_failures = [docker_container.circi]
}

run "typed_settings_and_secrets" {
  command = plan

  variables {
    log_level            = "debug"
    smtp_host            = "email-smtp.eu-west-1.amazonaws.com"
    smtp_from            = "CirCI <ci@acme.io>"
    smtp_user            = "AKIA"
    smtp_password        = "smtp-secret"
    s3_bucket            = "acme-circi"
    s3_region            = "eu-west-1"
    previous_public_urls = ["https://old.acme.io", "https://older.acme.io"]
    trusted_proxies      = ["10.0.0.0/8"]
    auth_sso_enabled     = false
  }

  assert {
    condition = alltrue([for e in [
      "LOG_LEVEL=debug",
      "SMTP_HOST=email-smtp.eu-west-1.amazonaws.com",
      "SMTP_USER=AKIA",
      "SMTP_PASSWORD_FILE=/run/circi/secrets/SMTP_PASSWORD",
      "STORAGE_DRIVER=s3",
      "S3_BUCKET=acme-circi",
      "S3_REGION=eu-west-1",
      "PREVIOUS_PUBLIC_URLS=https://old.acme.io,https://older.acme.io",
      "TRUSTED_PROXIES=10.0.0.0/8",
      "AUTH_SSO_ENABLED=false",
    ] : contains(docker_container.circi.env, e)])
    error_message = "Settings reach the server: ${join(", ", docker_container.circi.env)}"
  }
  assert {
    condition     = !issensitive(docker_container.circi.env)
    error_message = "The environment stays readable with secrets set."
  }
}

run "half_a_pair_fails_the_plan" {
  command = plan

  variables {
    smtp_host = "smtp.acme.io"
    smtp_from = "ci@acme.io"
    smtp_user = "ci"
  }

  expect_failures = [docker_container.circi]
}

run "bad_values_fail_validation" {
  command = plan

  variables {
    log_level          = "verbose"
    better_auth_secret = "short"
  }

  expect_failures = [var.log_level, var.better_auth_secret]
}

run "caddy_is_the_one_trusted_proxy" {
  command = plan

  variables {
    caddy = { dashboard_host = "ci.acme.io", sites_host = "acme-sites.com" }
    caddy_aws_credentials = {
      access_key_id     = "AKIAEXAMPLE"
      secret_access_key = "route53-secret"
    }
  }

  assert {
    condition = alltrue([for e in [
      "PUBLIC_URL=https://ci.acme.io",
      "TRUSTED_PROXIES=192.168.250.10",
      "STATIC_SITES_HOST=acme-sites.com",
    ] : contains(docker_container.circi.env, e)])
    error_message = "Caddy's settings: ${join(", ", docker_container.circi.env)}"
  }
  assert {
    condition     = one(docker_container.caddy[0].networks_advanced).ipv4_address == "192.168.250.10"
    error_message = "Caddy sits at the address the app trusts."
  }
  assert {
    condition     = !issensitive(docker_container.caddy[0].env) && length([for e in docker_container.caddy[0].env : e if strcontains(e, "route53-secret")]) == 0
    error_message = "Route53 keys stay out of Caddy's environment and the plan."
  }
  assert {
    condition     = length(docker_container.circi.ports) == 0
    error_message = "With Caddy, the app isn't published."
  }
}

run "caddy_owns_trusted_proxies" {
  command = plan

  variables {
    caddy           = { dashboard_host = "ci.acme.io", sites_host = "acme-sites.com" }
    trusted_proxies = ["10.0.0.0/8"]
  }

  expect_failures = [docker_container.circi]
}
