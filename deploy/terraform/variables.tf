variable "circi_version" {
  description = "The CirCI release to run, e.g. \"0.1.0\": the tag of ghcr.io/cir-ci/circi (and of the Caddy image). Change it and apply to update; the server applies database migrations when it starts."
  type        = string
  validation {
    condition     = can(regex("^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$", var.circi_version))
    error_message = "circi_version is a release version such as 0.1.0 (see the GitHub releases named @circi/server@<version>)."
  }
}

variable "image_repository" {
  description = "Where the CirCI image comes from. The Caddy image is the same name with -caddy."
  type        = string
  default     = "ghcr.io/cir-ci/circi"
}

variable "public_url" {
  description = "The dashboard's address (PUBLIC_URL), e.g. https://ci.acme.io. Ignored when caddy is set: it becomes https://<caddy.dashboard_host>."
  type        = string
  default     = "http://localhost:3000"
}

variable "better_auth_secret" {
  description = "Signs sessions and cookies (BETTER_AUTH_SECRET, 32+ characters; openssl rand -base64 32). Keep it stable: changing it signs everyone out."
  type        = string
  sensitive   = true
}

variable "database_url" {
  description = "An existing Postgres (DATABASE_URL). Leave null to run Postgres on the same host, in a container with its own volume."
  type        = string
  default     = null
  sensitive   = true
}

variable "postgres_password" {
  description = "Password of the bundled Postgres; needed when database_url is null."
  type        = string
  default     = null
  sensitive   = true
}

variable "postgres_image" {
  description = "The bundled Postgres's image. Keep the major version: a new major needs a dump and restore."
  type        = string
  default     = "postgres:18-alpine"
}

variable "environment" {
  description = "Other settings for the CirCI container, as in deploy/.env.example (SMTP_HOST, STATIC_SITES_HOST, STORAGE_DRIVER and S3_*, LOG_LEVEL, ...)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Settings that are secret (SMTP_PASSWORD, GITHUB_APP_PRIVATE_KEY, AUTH_*_CLIENT_SECRET, S3 keys, ...): passed like environment, kept out of plan output."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "port" {
  description = "Host port the app is published on when caddy is null (with Caddy, only 80 and 443 are published)."
  type        = number
  default     = 3000
}

variable "caddy" {
  description = "TLS for the dashboard and hosted sites with Caddy (deploy/Caddyfile; read docs/reference/static-sites.md first). Route53 credentials come from the host's instance role, or aws_access_key_id/aws_secret_access_key."
  type = object({
    dashboard_host        = string
    sites_host            = string
    aws_region            = optional(string, "us-east-1")
    aws_access_key_id     = optional(string)
    aws_secret_access_key = optional(string)
    trusted_proxies       = optional(string, "172.16.0.0/12,192.168.0.0/16")
  })
  default = null
}

variable "name_prefix" {
  description = "Prefix for the containers, volumes and network, so two installs can share a host."
  type        = string
  default     = "circi"
}
