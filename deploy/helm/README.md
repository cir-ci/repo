# deploy/helm

The Helm chart that runs a released CirCI on an existing Kubernetes cluster (EKS and others). Installing it, its values
and a complete EKS example are on the website: [Kubernetes](https://circi.dev/self-hosting/kubernetes/). This file is
about how the chart is built.

The chart creates nothing outside the cluster: Postgres, the S3 bucket and the IAM role are the operator's. It is
published on each app release as `oci://ghcr.io/cir-ci/charts/circi` (the `helm-chart` job of
`.github/workflows/release.yml`, with the job's `GITHUB_TOKEN`).

## How it's built

```
circi/Chart.yaml            version and appVersion are both the app's version
circi/values.yaml           the settings in the Terraform module's groups, then secrets, database, storage, Caddy, pods
circi/values.schema.json    every group closed (additionalProperties: false): a misspelled key fails the install
circi/files/Caddyfile       a copy of deploy/Caddyfile (a test keeps it equal)
circi/templates/            _helpers.tpl (settings, secrets, checks), deployment, service, ingress, caddy, ...
tests/values/*.yaml         the values the checks render: defaults, split, caddy, ingress
test.sh                     `pnpm test:helm`
```

- **Settings in groups.** Each group of the Terraform module (`smtp`, `s3`, `sso`, `githubApp`, `slack`, `vapid`, `sites`,
  `jobs`, `webhooks`, `tuning`) is a map in `values.yaml`, each key the setting's name in camel case (`smtp.host` is
  `SMTP_HOST`). `null` leaves the setting out of the pod's environment, so the server's default applies and settings the
  dashboard can change stay changeable there. `circi.settings` in `_helpers.tpl` is the one list of setting to value.
- **Secrets are files.** `circi.secrets` lists them; the chart's Secret (or the operator's, `secrets.existingSecret`)
  is mounted under `/run/circi/secrets`, one file per key, and each pod gets `<NAME>_FILE` for it (read by
  `resolveSettingFiles` in `@circi/config`). `DATABASE_URL` is built from `database.*` and the password, URL-encoded,
  with `sslmode=verify-full` and `sslrootcert=/run/circi/database-ca.pem` when a CA bundle is given.
- **Settings that go together** are checked in `circi.validate` (by their `SETTING_GROUPS` names), with what a topology
  needs: S3 for more than one pod or `split` mode, Caddy's hosts, no Caddy together with an Ingress.
- **One Service, named like the release**, selects the pods that serve HTTP (`all` or `serve`). Caddy's copy of the
  Caddyfile is rendered with that name in place of `circi:3000`, so the Caddyfile stays the one in `deploy/`.
- **`TRUSTED_PROXIES`.** Caddy's pod has no fixed address, so with Caddy or an Ingress the default is the private ranges
  (the pod and VPC addresses of any cluster), narrowed by `trustedProxies`; `networkPolicy.enabled` lets only the proxy
  reach the pods, which makes the wide range safe.
- **Caddy is one StatefulSet pod** with a volume for `/data` (the certificates), because several instances would each
  request them. Its Route53 credentials come from the AWS credential chain (IRSA on its own ServiceAccount) or a Secret.

## What keeps it in step with the server

`packages/config/test/deploy-settings.test.ts` (in `pnpm test`) fails when:

- a setting isn't in `circi.settings`, or a secret isn't in `circi.secrets` (every setting but the image's);
- `circi.validate` doesn't check the same groups as `SETTING_GROUPS`;
- a template reads a value that has no default in `values.yaml`;
- a group of the schema is open;
- `files/Caddyfile` differs from `deploy/Caddyfile`, or `Chart.yaml` from the server's version.

`pnpm version-packages` runs `scripts/sync-chart-version.mjs`, which copies the new app version into `Chart.yaml`.

`pnpm test:helm` (the CircleCI job `helm`) needs helm and, to check the manifests against Kubernetes' schemas,
kubeconform. It lints and renders the chart with each file in `tests/values/`, and checks that wrong values (a
misspelled key, half of a group, `split` mode without S3, Caddy with an Ingress, ...) are refused. No cluster.
