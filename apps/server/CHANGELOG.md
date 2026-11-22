# @circi/server

## 0.1.0

### Minor Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The app has versions: each release publishes `ghcr.io/cir-ci/circi:<version>` and `circi-caddy:<version>`, `circi --version` and `/healthz` report the version a server runs, and `deploy/terraform` runs a given version on a Docker host (`circi_version`).

### Patch Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Every server setting reaches the container in both deploys. The Terraform module takes the server's settings in groups (smtp, s3, sso, github_app, jobs, ...), each key named after its setting (smtp.host is SMTP_HOST), in place of the open environment/secrets maps: a misspelled key, a value of the wrong type or a half-set pair fails the plan, and a setting left out stays unset, so nothing is locked in the dashboard by accident. Secrets go in as files named by <NAME>_FILE, which the server now reads for any setting (circi admin storage migrate too), so the rest of the environment shows in plan output. database = { host, port, name, user, tls, ca_certificate } runs against your own Postgres such as Amazon RDS (verify-full, with RDS's CA bundle); passwords are URL-encoded. Caddy is the one proxy the app trusts, in Terraform and in the Compose overlay (a fixed subnet and address: CIRCI_SUBNET, CADDY_ADDRESS), instead of every private range. Route53 keys have their own sensitive variable, and the bundled Postgres's password can be rotated with ALTER USER. docker-compose.yml passes every setting (Slack, GitLab sign-in, S3 and the tuning settings never reached the server before) and .env.example names them all. The image sets HOST explicitly.
