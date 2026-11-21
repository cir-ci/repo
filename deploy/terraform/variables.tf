# One variable per server setting, named after it in lower case (SMTP_HOST is smtp_host), so a
# misspelled one fails the plan (`Unsupported argument`) and every change shows in it. null leaves the
# setting unset: the server's default applies, and settings the dashboard can change (Instance >
# Settings) stay changeable there. A setting that is set is locked in the dashboard.
#
# Secrets (sensitive = true) reach the container as files (`<NAME>_FILE`, read by the server), so the
# rest of the environment stays readable in plan output. The server's own settings are listed in
# packages/config/src/schema.ts; packages/config/test/terraform.test.ts fails when one has no variable.

# --- The release --------------------------------------------------------------------------------

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

variable "name_prefix" {
  description = "Prefix for the containers, volumes and network, so two installs can share a host."
  type        = string
  default     = "circi"
}

# --- Address and network ------------------------------------------------------------------------

variable "public_url" {
  description = "The dashboard's address (PUBLIC_URL), e.g. https://ci.acme.io. Ignored when caddy is set: it becomes https://<caddy.dashboard_host>."
  type        = string
  default     = "http://localhost:3000"
}

variable "previous_public_urls" {
  description = "Old dashboard addresses (PREVIOUS_PUBLIC_URLS), redirected to public_url so links in old PR comments and emails keep working."
  type        = list(string)
  default     = []
}

variable "port" {
  description = "Host port the app is published on when caddy is null (with Caddy, only 80 and 443 are published)."
  type        = number
  default     = 3000
}

variable "trusted_proxies" {
  description = "Without caddy: your proxy's addresses or CIDR ranges (TRUSTED_PROXIES), believed when they say who the client is. With caddy the module sets it to Caddy's address."
  type        = list(string)
  default     = []
}

variable "network_subnet" {
  description = "The Docker network's subnet. Caddy gets its 10th address, the only proxy the app trusts. It must not overlap a network the host reaches (an AWS default VPC is 172.31.0.0/16), or traffic to it (e.g. RDS) is routed into Docker."
  type        = string
  default     = "192.168.250.0/24"
  validation {
    condition     = can(cidrhost(var.network_subnet, 10))
    error_message = "network_subnet is an IPv4 CIDR range with at least 16 addresses, e.g. 192.168.250.0/24."
  }
}

variable "caddy" {
  description = "TLS for the dashboard and hosted sites with Caddy (deploy/Caddyfile; read docs/reference/static-sites.md first). Route53 credentials come from the host's instance role, or caddy_aws_credentials."
  type = object({
    dashboard_host = string
    sites_host     = string
    aws_region     = optional(string, "us-east-1")
  })
  default = null
}

variable "caddy_aws_credentials" {
  description = "Route53 credentials for Caddy's wildcard certificate, when the host has no instance role."
  type = object({
    access_key_id     = string
    secret_access_key = string
  })
  default   = null
  sensitive = true
}

# --- Secrets and the database -------------------------------------------------------------------

variable "better_auth_secret" {
  description = "Signs sessions and cookies (BETTER_AUTH_SECRET, 32+ characters; openssl rand -base64 32). Keep it stable: changing it signs everyone out."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.better_auth_secret) >= 32
    error_message = "better_auth_secret must be at least 32 characters (openssl rand -base64 32)."
  }
}

variable "postgres_password" {
  description = "Password of the bundled Postgres; needed when database is null. Postgres takes it only when its volume is first made: to change it later, run ALTER USER circi PASSWORD '...' in the database first, then apply."
  type        = string
  default     = null
  sensitive   = true
}

variable "postgres_image" {
  description = "The bundled Postgres's image. Keep the major version: a new major needs a dump and restore."
  type        = string
  default     = "postgres:18-alpine"
}

variable "database" {
  description = "Your own Postgres 13+ (Amazon RDS, Cloud SQL, ...) instead of the bundled one. tls verifies the server's certificate (sslmode=verify-full); ca_certificate is the PEM it chains to when that isn't a public CA (RDS: the global bundle, https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem). Connect directly, not through RDS Proxy or PgBouncer in transaction mode: the server LISTENs and holds session locks."
  type = object({
    host           = string
    port           = optional(number, 5432)
    name           = optional(string, "circi")
    user           = string
    tls            = optional(bool, true)
    ca_certificate = optional(string)
  })
  default = null
  validation {
    condition     = var.database == null || try(var.database.ca_certificate == null || var.database.tls, false)
    error_message = "database.ca_certificate is only used with tls = true."
  }
}

variable "database_password" {
  description = "The password of database.user (special characters are fine: the module encodes it). IAM database authentication isn't supported."
  type        = string
  default     = null
  sensitive   = true
}

variable "database_pool_max" {
  description = "DATABASE_POOL_MAX: connections the server's pool may open (default 10). It also opens a few of its own (live updates, locks): leave room under the database's max_connections."
  type        = number
  default     = null
}

# --- Storage ------------------------------------------------------------------------------------

variable "s3_bucket" {
  description = "Keep screenshots in this S3 bucket (STORAGE_DRIVER=s3) instead of the host's volume. Credentials: s3_access_key_id / s3_secret_access_key, or the host's instance role (an EC2 instance needs its metadata hop limit at 2 for a container to reach the role)."
  type        = string
  default     = null
}

variable "s3_region" {
  description = "S3_REGION (default us-east-1)."
  type        = string
  default     = null
}

variable "s3_endpoint" {
  description = "S3_ENDPOINT: an S3-compatible store (MinIO, R2, ...) instead of AWS."
  type        = string
  default     = null
}

variable "s3_force_path_style" {
  description = "S3_FORCE_PATH_STYLE (default: true with s3_endpoint, false without)."
  type        = bool
  default     = null
}

variable "s3_access_key_id" {
  description = "S3_ACCESS_KEY_ID; set with s3_secret_access_key, or neither for the instance role."
  type        = string
  default     = null
}

variable "s3_secret_access_key" {
  description = "S3_SECRET_ACCESS_KEY."
  type        = string
  default     = null
  sensitive   = true
}

variable "s3_connect_timeout_seconds" {
  description = "S3_CONNECT_TIMEOUT_SECONDS (default 10)."
  type        = number
  default     = null
}

variable "s3_request_timeout_seconds" {
  description = "S3_REQUEST_TIMEOUT_SECONDS: silence allowed on an open request (default 60)."
  type        = number
  default     = null
}

# --- Email --------------------------------------------------------------------------------------

variable "smtp_host" {
  description = "SMTP_HOST: outgoing mail, for email sign-in codes and invitations. Locks the dashboard's SMTP settings."
  type        = string
  default     = null
}

variable "smtp_port" {
  description = "SMTP_PORT (default 465 with smtp_secure, else 587)."
  type        = number
  default     = null
}

variable "smtp_secure" {
  description = "SMTP_SECURE: implicit TLS (default: true on port 465)."
  type        = bool
  default     = null
}

variable "smtp_user" {
  description = "SMTP_USER; set with smtp_password, or neither for a server without login."
  type        = string
  default     = null
}

variable "smtp_password" {
  description = "SMTP_PASSWORD."
  type        = string
  default     = null
  sensitive   = true
}

variable "smtp_from" {
  description = "SMTP_FROM, e.g. \"CirCI <ci@acme.io>\"; required with smtp_host."
  type        = string
  default     = null
}

# --- Sign-in ------------------------------------------------------------------------------------

variable "auth_email_enabled" {
  description = "AUTH_EMAIL_ENABLED: email-code sign-in (default on when SMTP is set). Locks the dashboard setting."
  type        = bool
  default     = null
}

variable "auth_password_enabled" {
  description = "AUTH_PASSWORD_ENABLED: password sign-in (default on). Locks the dashboard setting."
  type        = bool
  default     = null
}

variable "auth_sso_enabled" {
  description = "AUTH_SSO_ENABLED: single sign-on with the providers below (default on). Locks the dashboard setting."
  type        = bool
  default     = null
}

variable "auth_github_client_id" {
  description = "AUTH_GITHUB_CLIENT_ID: sign in with GitHub (callback <public_url>/api/auth/callback/github)."
  type        = string
  default     = null
}

variable "auth_github_client_secret" {
  description = "AUTH_GITHUB_CLIENT_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "auth_google_client_id" {
  description = "AUTH_GOOGLE_CLIENT_ID: sign in with Google (callback <public_url>/api/auth/callback/google)."
  type        = string
  default     = null
}

variable "auth_google_client_secret" {
  description = "AUTH_GOOGLE_CLIENT_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "auth_gitlab_client_id" {
  description = "AUTH_GITLAB_CLIENT_ID: sign in with GitLab (callback <public_url>/api/auth/callback/gitlab)."
  type        = string
  default     = null
}

variable "auth_gitlab_client_secret" {
  description = "AUTH_GITLAB_CLIENT_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "auth_gitlab_url" {
  description = "AUTH_GITLAB_URL: a self-managed GitLab (default gitlab.com)."
  type        = string
  default     = null
}

variable "auth_oidc_issuer" {
  description = "AUTH_OIDC_ISSUER: any OpenID Connect provider (Okta, Entra ID, Keycloak, ...); callback <public_url>/api/auth/callback/oidc."
  type        = string
  default     = null
}

variable "auth_oidc_client_id" {
  description = "AUTH_OIDC_CLIENT_ID."
  type        = string
  default     = null
}

variable "auth_oidc_client_secret" {
  description = "AUTH_OIDC_CLIENT_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "auth_oidc_name" {
  description = "AUTH_OIDC_NAME: the button's label (default \"Single sign-on\")."
  type        = string
  default     = null
}

variable "auth_oidc_trusted_for_email" {
  description = "AUTH_OIDC_TRUSTED_FOR_EMAIL: true only if the provider verifies every address it reports (default false)."
  type        = bool
  default     = null
}

variable "workspace_creation" {
  description = "WORKSPACE_CREATION: who may create workspaces, \"admin\" (default) or \"anyone\". Locks the dashboard setting."
  type        = string
  default     = null
  validation {
    condition     = var.workspace_creation == null || contains(["admin", "anyone"], coalesce(var.workspace_creation, "admin"))
    error_message = "workspace_creation is \"admin\" or \"anyone\"."
  }
}

# --- GitHub App and Slack -----------------------------------------------------------------------

variable "github_app_id" {
  description = "GITHUB_APP_ID: the GitHub App for checks and PR comments; set with github_app_private_key and github_app_webhook_secret."
  type        = string
  default     = null
}

variable "github_app_private_key" {
  description = "GITHUB_APP_PRIVATE_KEY: the App's PEM key, e.g. file(\"circi.private-key.pem\")."
  type        = string
  default     = null
  sensitive   = true
}

variable "github_app_webhook_secret" {
  description = "GITHUB_APP_WEBHOOK_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "github_api_url" {
  description = "GITHUB_API_URL: GitHub Enterprise Server's API, e.g. https://ghe.acme.io/api/v3."
  type        = string
  default     = null
}

variable "github_api_timeout_seconds" {
  description = "GITHUB_API_TIMEOUT_SECONDS (default 15)."
  type        = number
  default     = null
}

variable "slack_client_id" {
  description = "SLACK_CLIENT_ID: the Slack app; set with slack_client_secret. Locks the dashboard's Slack settings."
  type        = string
  default     = null
}

variable "slack_client_secret" {
  description = "SLACK_CLIENT_SECRET."
  type        = string
  default     = null
  sensitive   = true
}

variable "slack_api_url" {
  description = "SLACK_API_URL (default https://slack.com/api)."
  type        = string
  default     = null
}

# --- Web push -----------------------------------------------------------------------------------

variable "vapid_public_key" {
  description = "VAPID_PUBLIC_KEY: pin the web push keys (set with vapid_private_key). Unset, the server makes its own and keeps them in the database."
  type        = string
  default     = null
}

variable "vapid_private_key" {
  description = "VAPID_PRIVATE_KEY."
  type        = string
  default     = null
  sensitive   = true
}

variable "vapid_subject" {
  description = "VAPID_SUBJECT: mailto: or https: contact for push services (default public_url)."
  type        = string
  default     = null
}

# --- Hosted sites -------------------------------------------------------------------------------

variable "static_sites_host" {
  description = "STATIC_SITES_HOST, without caddy (with caddy it is caddy.sites_host): a domain used for nothing else; read docs/reference/static-sites.md."
  type        = string
  default     = null
}

variable "static_sites_max_mb" {
  description = "STATIC_SITES_MAX_MB: the largest site upload (default 200). Locks the dashboard setting."
  type        = number
  default     = null
}

# --- Jobs, limits and tuning --------------------------------------------------------------------

variable "log_level" {
  description = "LOG_LEVEL: fatal, error, warn, info (default), debug or trace."
  type        = string
  default     = null
  validation {
    condition     = var.log_level == null || contains(["fatal", "error", "warn", "info", "debug", "trace"], coalesce(var.log_level, "info"))
    error_message = "log_level is one of fatal, error, warn, info, debug, trace."
  }
}

variable "upload_timeout_minutes" {
  description = "UPLOAD_TIMEOUT_MINUTES: builds still uploading after this long fail (default 60, 0 = never). Locks the dashboard setting."
  type        = number
  default     = null
}

variable "gc_grace_hours" {
  description = "GC_GRACE_HOURS: how long unused files are kept before deletion (default 24). Locks the dashboard setting."
  type        = number
  default     = null
}

variable "job_retention_days" {
  description = "JOB_RETENTION_DAYS: how long finished jobs are kept (default 14). Locks the dashboard setting."
  type        = number
  default     = null
}

variable "job_retry_base_seconds" {
  description = "JOB_RETRY_BASE_SECONDS: first wait before a failed job is retried, doubling after (default 2)."
  type        = number
  default     = null
}

variable "job_retry_max_seconds" {
  description = "JOB_RETRY_MAX_SECONDS: the longest wait between two attempts (default 300)."
  type        = number
  default     = null
}

variable "webhook_timeout_seconds" {
  description = "WEBHOOK_TIMEOUT_SECONDS: how long a webhook receiver may take to answer (default 10). Locks the dashboard setting."
  type        = number
  default     = null
}

variable "webhook_allow_private_addresses" {
  description = "WEBHOOK_ALLOW_PRIVATE_ADDRESSES: let webhooks call private addresses (default false). Only if your receivers live on your own network."
  type        = bool
  default     = null
}

variable "live_max_streams" {
  description = "LIVE_MAX_STREAMS: live dashboard streams one server keeps open (default 2000)."
  type        = number
  default     = null
}

variable "diff_engine" {
  description = "CIRCI_DIFF_ENGINE: native (default), js-workers or js."
  type        = string
  default     = null
  validation {
    condition     = var.diff_engine == null || contains(["native", "js-workers", "js"], coalesce(var.diff_engine, "native"))
    error_message = "diff_engine is native, js-workers or js."
  }
}

variable "diff_threads" {
  description = "CIRCI_DIFF_THREADS: threads of the js-workers engine (default: cores - 1)."
  type        = number
  default     = null
}
