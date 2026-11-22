{{/* Names and labels. */}}
{{- define "circi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* The Service's name: the release's, or <release>-circi. Caddy's upstream is this, port 3000. */}}
{{- define "circi.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains (include "circi.name" .) .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "circi.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "circi.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "circi.selectorLabels" -}}
app.kubernetes.io/name: {{ include "circi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "circi.labels" -}}
helm.sh/chart: {{ include "circi.chart" . }}
{{ include "circi.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "circi.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "circi.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "circi.caddyServiceAccountName" -}}
{{- if .Values.caddy.serviceAccount.create -}}
{{- default (printf "%s-caddy" (include "circi.fullname" .)) .Values.caddy.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.caddy.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The files volume is only used without S3. */}}
{{- define "circi.usesFiles" -}}
{{- if not .Values.s3.bucket -}}true{{- end -}}
{{- end -}}

{{/* A value as a setting's text: booleans and whole numbers the way an environment variable has them. */}}
{{- define "circi.str" -}}
{{- if kindIs "float64" . -}}
{{- if eq . (floor . | float64) -}}{{ printf "%d" (int64 .) }}{{- else -}}{{ . }}{{- end -}}
{{- else -}}
{{- . | toString -}}
{{- end -}}
{{- end -}}

{{/* Sets (dict, name, value) unless the value is null or empty: a setting left out takes the server's default. */}}
{{- define "circi.set" -}}
{{- $value := index . 2 -}}
{{- if not (or (kindIs "invalid" $value) (and (kindIs "string" $value) (eq $value ""))) -}}
{{- $_ := set (index . 0) (index . 1) (include "circi.str" $value) -}}
{{- end -}}
{{- end -}}

{{- define "circi.publicUrl" -}}
{{- if .Values.caddy.enabled -}}https://{{ .Values.caddy.dashboardHost }}{{- else -}}{{ .Values.publicUrl }}{{- end -}}
{{- end -}}

{{/* TRUSTED_PROXIES: yours, else the private ranges when a proxy (Caddy, an Ingress) is in front. */}}
{{- define "circi.trustedProxies" -}}
{{- if .Values.trustedProxies -}}
{{- join "," .Values.trustedProxies -}}
{{- else if or .Values.caddy.enabled .Values.ingress.enabled -}}
10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
{{- end -}}
{{- end -}}

{{/*
Every server setting that is set, as YAML (NAME: value), for the pods' environment. The settings the
image fixes (NODE_ENV, HOST, PORT, STORAGE_PATH, CIRCI_MIGRATIONS, CIRCI_WEB_DIST) are not here.
packages/config/test/deploy-settings.test.ts holds this list to the server's settings.
*/}}
{{- define "circi.settings" -}}
{{- $e := dict -}}
{{- include "circi.set" (list $e "PUBLIC_URL" (include "circi.publicUrl" .)) -}}
{{- include "circi.set" (list $e "PREVIOUS_PUBLIC_URLS" (join "," .Values.previousPublicUrls)) -}}
{{- include "circi.set" (list $e "TRUSTED_PROXIES" (include "circi.trustedProxies" .)) -}}
{{- include "circi.set" (list $e "LOG_LEVEL" .Values.logLevel) -}}
{{- include "circi.set" (list $e "WORKSPACE_CREATION" .Values.workspaceCreation) -}}
{{- include "circi.set" (list $e "STORAGE_DRIVER" (ternary "s3" "" (not (empty .Values.s3.bucket)))) -}}
{{- include "circi.set" (list $e "S3_BUCKET" .Values.s3.bucket) -}}
{{- include "circi.set" (list $e "S3_REGION" .Values.s3.region) -}}
{{- include "circi.set" (list $e "S3_ENDPOINT" .Values.s3.endpoint) -}}
{{- include "circi.set" (list $e "S3_FORCE_PATH_STYLE" .Values.s3.forcePathStyle) -}}
{{- include "circi.set" (list $e "S3_ACCESS_KEY_ID" .Values.s3.accessKeyId) -}}
{{- include "circi.set" (list $e "S3_CONNECT_TIMEOUT_SECONDS" .Values.s3.connectTimeoutSeconds) -}}
{{- include "circi.set" (list $e "S3_REQUEST_TIMEOUT_SECONDS" .Values.s3.requestTimeoutSeconds) -}}
{{- include "circi.set" (list $e "SMTP_HOST" .Values.smtp.host) -}}
{{- include "circi.set" (list $e "SMTP_PORT" .Values.smtp.port) -}}
{{- include "circi.set" (list $e "SMTP_SECURE" .Values.smtp.secure) -}}
{{- include "circi.set" (list $e "SMTP_USER" .Values.smtp.user) -}}
{{- include "circi.set" (list $e "SMTP_FROM" .Values.smtp.from) -}}
{{- include "circi.set" (list $e "AUTH_EMAIL_ENABLED" .Values.signIn.email) -}}
{{- include "circi.set" (list $e "AUTH_PASSWORD_ENABLED" .Values.signIn.password) -}}
{{- include "circi.set" (list $e "AUTH_SSO_ENABLED" .Values.signIn.sso) -}}
{{- include "circi.set" (list $e "AUTH_GITHUB_CLIENT_ID" .Values.sso.githubClientId) -}}
{{- include "circi.set" (list $e "AUTH_GOOGLE_CLIENT_ID" .Values.sso.googleClientId) -}}
{{- include "circi.set" (list $e "AUTH_GITLAB_CLIENT_ID" .Values.sso.gitlabClientId) -}}
{{- include "circi.set" (list $e "AUTH_GITLAB_URL" .Values.sso.gitlabUrl) -}}
{{- include "circi.set" (list $e "AUTH_OIDC_ISSUER" .Values.sso.oidcIssuer) -}}
{{- include "circi.set" (list $e "AUTH_OIDC_CLIENT_ID" .Values.sso.oidcClientId) -}}
{{- include "circi.set" (list $e "AUTH_OIDC_NAME" .Values.sso.oidcName) -}}
{{- include "circi.set" (list $e "AUTH_OIDC_TRUSTED_FOR_EMAIL" .Values.sso.oidcTrustedForEmail) -}}
{{- include "circi.set" (list $e "GITHUB_APP_ID" .Values.githubApp.id) -}}
{{- include "circi.set" (list $e "GITHUB_API_URL" .Values.githubApp.apiUrl) -}}
{{- include "circi.set" (list $e "GITHUB_API_TIMEOUT_SECONDS" .Values.githubApp.apiTimeoutSeconds) -}}
{{- include "circi.set" (list $e "SLACK_CLIENT_ID" .Values.slack.clientId) -}}
{{- include "circi.set" (list $e "SLACK_API_URL" .Values.slack.apiUrl) -}}
{{- include "circi.set" (list $e "VAPID_PUBLIC_KEY" .Values.vapid.publicKey) -}}
{{- include "circi.set" (list $e "VAPID_SUBJECT" .Values.vapid.subject) -}}
{{- include "circi.set" (list $e "STATIC_SITES_HOST" (ternary .Values.caddy.sitesHost .Values.sites.host .Values.caddy.enabled)) -}}
{{- include "circi.set" (list $e "STATIC_SITES_MAX_MB" .Values.sites.maxMb) -}}
{{- include "circi.set" (list $e "UPLOAD_TIMEOUT_MINUTES" .Values.jobs.uploadTimeoutMinutes) -}}
{{- include "circi.set" (list $e "GC_GRACE_HOURS" .Values.jobs.gcGraceHours) -}}
{{- include "circi.set" (list $e "JOB_RETENTION_DAYS" .Values.jobs.retentionDays) -}}
{{- include "circi.set" (list $e "JOB_RETRY_BASE_SECONDS" .Values.jobs.retryBaseSeconds) -}}
{{- include "circi.set" (list $e "JOB_RETRY_MAX_SECONDS" .Values.jobs.retryMaxSeconds) -}}
{{- include "circi.set" (list $e "WEBHOOK_TIMEOUT_SECONDS" .Values.webhooks.timeoutSeconds) -}}
{{- include "circi.set" (list $e "WEBHOOK_ALLOW_PRIVATE_ADDRESSES" .Values.webhooks.allowPrivateAddresses) -}}
{{- include "circi.set" (list $e "DATABASE_POOL_MAX" .Values.tuning.databasePoolMax) -}}
{{- include "circi.set" (list $e "CIRCI_DIFF_ENGINE" .Values.tuning.diffEngine) -}}
{{- include "circi.set" (list $e "CIRCI_DIFF_THREADS" .Values.tuning.diffThreads) -}}
{{- include "circi.set" (list $e "LIVE_MAX_STREAMS" .Values.tuning.liveMaxStreams) -}}
{{- toYaml $e -}}
{{- end -}}

{{/* DATABASE_URL: given whole, or built from database.* and the password (URL-encoded, a space as %20). */}}
{{- define "circi.databaseUrl" -}}
{{- if .Values.secrets.databaseUrl -}}
{{- .Values.secrets.databaseUrl -}}
{{- else -}}
{{- $db := .Values.database -}}
{{- $enc := dict "user" ($db.user | default "" | toString | urlquery | replace "+" "%20") "password" (.Values.secrets.databasePassword | default "" | toString | urlquery | replace "+" "%20") "name" ($db.name | default "" | toString | urlquery | replace "+" "%20") -}}
{{- $query := "?sslmode=disable" -}}
{{- if $db.tls -}}
{{- $query = ternary "?sslmode=verify-full&sslrootcert=/run/circi/database-ca.pem" "?sslmode=verify-full" (or (not (empty $db.caCertificate)) (not (empty $db.existingCaConfigMap))) -}}
{{- end -}}
{{- printf "postgres://%s:%s@%s:%d/%s%s" $enc.user $enc.password $db.host (int $db.port) $enc.name $query -}}
{{- end -}}
{{- end -}}

{{/*
The secrets as YAML (NAME: value), one per setting that is secret. With secrets.existingSecret only the
names count (the values are empty): the keys of that Secret the pods read.
*/}}
{{- define "circi.secrets" -}}
{{- $s := dict -}}
{{- if .Values.secrets.existingSecret -}}
{{- range (concat (list "BETTER_AUTH_SECRET" "DATABASE_URL") .Values.secrets.existingSecretKeys | uniq) -}}
{{- $_ := set $s . "-" -}}
{{- end -}}
{{- else -}}
{{- include "circi.set" (list $s "BETTER_AUTH_SECRET" .Values.secrets.betterAuthSecret) -}}
{{- include "circi.set" (list $s "DATABASE_URL" (include "circi.databaseUrl" .)) -}}
{{- include "circi.set" (list $s "S3_SECRET_ACCESS_KEY" .Values.secrets.s3SecretAccessKey) -}}
{{- include "circi.set" (list $s "SMTP_PASSWORD" .Values.secrets.smtpPassword) -}}
{{- include "circi.set" (list $s "GITHUB_APP_PRIVATE_KEY" .Values.secrets.githubAppPrivateKey) -}}
{{- include "circi.set" (list $s "GITHUB_APP_WEBHOOK_SECRET" .Values.secrets.githubAppWebhookSecret) -}}
{{- include "circi.set" (list $s "SLACK_CLIENT_SECRET" .Values.secrets.slackClientSecret) -}}
{{- include "circi.set" (list $s "VAPID_PRIVATE_KEY" .Values.secrets.vapidPrivateKey) -}}
{{- include "circi.set" (list $s "AUTH_GITHUB_CLIENT_SECRET" .Values.secrets.authGithubClientSecret) -}}
{{- include "circi.set" (list $s "AUTH_GOOGLE_CLIENT_SECRET" .Values.secrets.authGoogleClientSecret) -}}
{{- include "circi.set" (list $s "AUTH_GITLAB_CLIENT_SECRET" .Values.secrets.authGitlabClientSecret) -}}
{{- include "circi.set" (list $s "AUTH_OIDC_CLIENT_SECRET" .Values.secrets.authOidcClientSecret) -}}
{{- end -}}
{{- toYaml $s -}}
{{- end -}}

{{/* The Secret the pods read. */}}
{{- define "circi.secretName" -}}
{{- default (include "circi.fullname" .) .Values.secrets.existingSecret -}}
{{- end -}}

{{/*
Checks the values the schema can't: settings that go together are all set or none (SETTING_GROUPS in
packages/config/src/settings.ts, by those names), what a setting needs, and what the topology needs.
*/}}
{{- define "circi.validate" -}}
{{- $set := include "circi.settings" . | fromYaml -}}
{{- $secrets := include "circi.secrets" . | fromYaml -}}
{{- $groups := dict
  "smtpLogin" (list "SMTP_USER" "SMTP_PASSWORD")
  "s3Keys" (list "S3_ACCESS_KEY_ID" "S3_SECRET_ACCESS_KEY")
  "githubApp" (list "GITHUB_APP_ID" "GITHUB_APP_PRIVATE_KEY" "GITHUB_APP_WEBHOOK_SECRET")
  "slack" (list "SLACK_CLIENT_ID" "SLACK_CLIENT_SECRET")
  "vapid" (list "VAPID_PUBLIC_KEY" "VAPID_PRIVATE_KEY")
  "authGithub" (list "AUTH_GITHUB_CLIENT_ID" "AUTH_GITHUB_CLIENT_SECRET")
  "authGoogle" (list "AUTH_GOOGLE_CLIENT_ID" "AUTH_GOOGLE_CLIENT_SECRET")
  "authGitlab" (list "AUTH_GITLAB_CLIENT_ID" "AUTH_GITLAB_CLIENT_SECRET")
  "authOidc" (list "AUTH_OIDC_ISSUER" "AUTH_OIDC_CLIENT_ID" "AUTH_OIDC_CLIENT_SECRET")
-}}
{{- range $group, $names := $groups -}}
{{- $count := 0 -}}
{{- range $names -}}
{{- if or (hasKey $set .) (hasKey $secrets .) -}}{{- $count = add1 $count -}}{{- end -}}
{{- end -}}
{{- if and (gt $count 0) (lt $count (len $names)) -}}
{{- fail (printf "These settings go together, set all of them or none: %s." (join " / " $names)) -}}
{{- end -}}
{{- end -}}
{{- if not .Values.secrets.existingSecret -}}
{{- if lt (len (.Values.secrets.betterAuthSecret | default "" | toString)) 32 -}}
{{- fail "secrets.betterAuthSecret is required and at least 32 characters (openssl rand -base64 32), or point secrets.existingSecret at a Secret with BETTER_AUTH_SECRET." -}}
{{- end -}}
{{- if and (not .Values.secrets.databaseUrl) (or (not .Values.database.host) (not .Values.database.user) (not .Values.secrets.databasePassword)) -}}
{{- fail "Set database.host, database.user and secrets.databasePassword (or secrets.databaseUrl), or point secrets.existingSecret at a Secret with DATABASE_URL." -}}
{{- end -}}
{{- end -}}
{{- if and (hasKey $set "SMTP_HOST") (not (hasKey $set "SMTP_FROM")) -}}
{{- fail "smtp.from is required with smtp.host." -}}
{{- end -}}
{{- if and (not .Values.s3.bucket) (or .Values.s3.region .Values.s3.endpoint .Values.s3.accessKeyId (not (kindIs "invalid" .Values.s3.forcePathStyle))) -}}
{{- fail "s3 needs a bucket." -}}
{{- end -}}
{{- if and (not .Values.s3.bucket) (or (eq .Values.mode "split") (gt (int .Values.all.replicas) 1)) -}}
{{- fail "Pods can't share the files volume: set s3.bucket to run mode \"split\" or more than one replica." -}}
{{- end -}}
{{- if and .Values.caddy.enabled (or (not .Values.caddy.dashboardHost) (not .Values.caddy.sitesHost)) -}}
{{- fail "caddy.dashboardHost and caddy.sitesHost are required with caddy.enabled." -}}
{{- end -}}
{{- if and .Values.caddy.enabled .Values.sites.host -}}
{{- fail "With caddy.enabled, STATIC_SITES_HOST is caddy.sitesHost: leave sites.host unset." -}}
{{- end -}}
{{- if and .Values.caddy.enabled .Values.ingress.enabled -}}
{{- fail "Use caddy or ingress for the dashboard, not both." -}}
{{- end -}}
{{- if and .Values.networkPolicy.enabled (not (or .Values.caddy.enabled .Values.ingress.enabled)) -}}
{{- fail "networkPolicy.enabled needs caddy.enabled or ingress.enabled: it only lets those reach CirCI." -}}
{{- end -}}
{{- end -}}
