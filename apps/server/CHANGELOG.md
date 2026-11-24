# @circi/server

## 0.2.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

- [#57](https://github.com/cir-ci/repo/pull/57) [`f16b179`](https://github.com/cir-ci/repo/commit/f16b179813a2867e5aa1626213ef28017465471f) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Resetting a test database between tests (`reset()` from `@circi/db/testing`, and the server tests' snapshot restore) now deletes every row instead of truncating. TRUNCATE creates new files for all 60 tables and their indexes, about 45 ms of server CPU each time. For the few rows a test leaves behind, deleting costs next to nothing. It had been half of the test Postgres server's work. Foreign keys aren't checked while the rows are deleted, and the one sequence restarts as before.

- [#57](https://github.com/cir-ci/repo/pull/57) [`f16b179`](https://github.com/cir-ci/repo/commit/f16b179813a2867e5aa1626213ef28017465471f) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Tests now run on a real Postgres server instead of PGlite, an in-process copy of Postgres. Each test file gets its own database, copied from one migrated template database on that server. Each PGlite database had used several gigabytes in the test process. Now the server holds the data, so the gate's test jobs need much less memory. On your machine, Testcontainers starts a `postgres:18-alpine` container the first time and later runs reuse it, so Docker must be running. On CI, and anywhere `CIRCI_TEST_DATABASE_URL` is set, the tests use that server instead. Production code is unchanged.

## 0.2.1

### Patch Changes

- [#46](https://github.com/cir-ci/repo/pull/46) [`5b0393f`](https://github.com/cir-ci/repo/commit/5b0393f45ff43120dd9bf71d53daed64b104aa62) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The Docker images, `ghcr.io/cir-ci/circi` and `ghcr.io/cir-ci/circi-caddy`, are published for `linux/arm64` as well as `linux/amd64`, so CirCI runs natively on ARM servers (AWS Graviton, Ampere, a Raspberry Pi 4 or 5 with a 64-bit OS) and Apple Silicon. Docker picks the right one; nothing changes in Compose, Terraform or Helm. Each platform is built on a native runner, including the Rust diff engine.

- [#48](https://github.com/cir-ci/repo/pull/48) [`4dd281f`](https://github.com/cir-ci/repo/commit/4dd281f64da4e9435a771cbc4a5fa408ac2b6a21) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A worker that has just started no longer misses a delayed job queued while it was connecting to the database's notifications: it checks for work as soon as it is listening, so the job starts at its run time instead of up to a poll interval (5 seconds) later.

## 0.2.0

### Minor Changes

- [#44](https://github.com/cir-ci/repo/pull/44) [`365fbaa`](https://github.com/cir-ci/repo/commit/365fbaa8e5857dc73cc2723504c0627377f7aa07) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed the Argos-compatible `/v2` API, which never worked with the real Argos SDKs (they reject CirCI's token format and localhost, and expect a different baseline reply). Upload with `circi upload`, the Vitest plugin or the Cypress plugin. A migration drops the unused `commit_ancestry` table (`builds.history_source` stays for one more release so a rolling deploy is safe), and builds that recorded `sdk` as their baseline source now show none. The Projects empty state no longer mentions Argos.

## 0.1.1

### Patch Changes

- [#7](https://github.com/cir-ci/repo/pull/7) [`72a2172`](https://github.com/cir-ci/repo/commit/72a2172b64bda357daf3c2f7b5235e33cfb93d4d) Thanks [@michaelhazan](https://github.com/michaelhazan)! - `circi admin doctor`'s hosted-sites warning links to https://circi.dev/self-hosting/site-domains/ instead of a file in the source repository, and so do the deploy files (the Caddyfile, the Caddy overlay, `.env.example` and the Terraform module).

- [#25](https://github.com/cir-ci/repo/pull/25) [`613c6f6`](https://github.com/cir-ci/repo/commit/613c6f61dd0d458fa038cea02b921f52381e8b0b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - CirCI now has a Helm chart for running it on an existing Kubernetes cluster such as EKS, published with each release as `oci://ghcr.io/cir-ci/charts/circi`. You bring Postgres, the S3 bucket and the IAM role; the chart runs the app (together or as separate serve and worker pods), reads secrets as files, and can run Caddy for hosted sites or use an Ingress for the dashboard. The Terraform module for a Docker host is unchanged.

- [#38](https://github.com/cir-ci/repo/pull/38) [`6efde8b`](https://github.com/cir-ci/repo/commit/6efde8bb1b3a199fe9d4894439cf36dab21a51e6) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The site kind detection tests each have their own name, so Flakiness.io can track them separately. Nothing changes in how sites are detected.

- [#23](https://github.com/cir-ci/repo/pull/23) [`1d1c195`](https://github.com/cir-ci/repo/commit/1d1c195e51355895e018c00c5a9ba12a0ab83866) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The Terraform module will be on the Terraform Registry as `cir-ci/circi/docker`, one version per release, so `source = "cir-ci/circi/docker"` with `version = "<release>"` replaces the Git URL (which keeps working). The module now reads a `Caddyfile` inside its own folder; the Caddy configuration it applies is unchanged.

- [#33](https://github.com/cir-ci/repo/pull/33) [`6c341b8`](https://github.com/cir-ci/repo/commit/6c341b8bfaf548da2d019c160f2de8a68fdc1a50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A test of the stored GitHub App no longer fails now and then: its fake private key could show up by chance in the encrypted value it checks. Nothing changes for people running CirCI.

- [#40](https://github.com/cir-ci/repo/pull/40) [`a485d66`](https://github.com/cir-ci/repo/commit/a485d6669f5bd06c50305b180aee282952f45d91) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Push notifications no longer stop for everyone now and then. About 1 in 256 of the server's web push keys was read back as invalid, so the server made new keys and dropped every device's subscription, and people had to turn push on again. Keys made before this release keep working.

- [#38](https://github.com/cir-ci/repo/pull/38) [`6efde8b`](https://github.com/cir-ci/repo/commit/6efde8bb1b3a199fe9d4894439cf36dab21a51e6) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A ListRow test no longer fails now and then on a busy machine: it no longer depends on where an earlier test left the mouse pointer. Nothing changes in the component.

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The server and dashboard tests run in about half the time: test files now share loaded modules instead of loading the server again for each one. Nothing changes in the app.

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The image library is loaded when the server first reads, diffs or resizes an image, not when it starts, which makes startup and the test suite faster. Image handling is unchanged.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.

- [#8](https://github.com/cir-ci/repo/pull/8) [`37c0620`](https://github.com/cir-ci/repo/commit/37c0620c68278e75d67fae9257b6028ce1046828) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The repository's READMEs are about the code, and using and running CirCI is documented on https://circi.dev only: the root README links the site and maps the code's folders, `deploy/README.md` and `deploy/terraform/README.md` explain how the image and the Terraform module are built (their usage is on the Docker Compose and Terraform pages), and the `docs/` folder is gone, its pages being on the site. `.env.example`'s GitHub App note links https://circi.dev/integrations/github/.

- [#26](https://github.com/cir-ci/repo/pull/26) [`aa2c4c6`](https://github.com/cir-ci/repo/commit/aa2c4c6f8563a59652432f69f965fc76c9a47099) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The Terraform module works from a Windows Git checkout (it no longer relies on a symlink for its `Caddyfile`), and each version on the Terraform Registry holds the module exactly as it was released, with the license.

## 0.1.0

### Minor Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The app has versions: each release publishes `ghcr.io/cir-ci/circi:<version>` and `circi-caddy:<version>`, `circi --version` and `/healthz` report the version a server runs, and `deploy/terraform` runs a given version on a Docker host (`circi_version`).

### Patch Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Every server setting reaches the container in both deploys. The Terraform module takes the server's settings in groups (smtp, s3, sso, github_app, jobs, ...), each key named after its setting (smtp.host is SMTP_HOST), in place of the open environment/secrets maps: a misspelled key, a value of the wrong type or a half-set pair fails the plan, and a setting left out stays unset, so nothing is locked in the dashboard by accident. Secrets go in as files named by <NAME>_FILE, which the server now reads for any setting (circi admin storage migrate too), so the rest of the environment shows in plan output. database = { host, port, name, user, tls, ca_certificate } runs against your own Postgres such as Amazon RDS (verify-full, with RDS's CA bundle); passwords are URL-encoded. Caddy is the one proxy the app trusts, in Terraform and in the Compose overlay (a fixed subnet and address: CIRCI_SUBNET, CADDY_ADDRESS), instead of every private range. Route53 keys have their own sensitive variable, and the bundled Postgres's password can be rotated with ALTER USER. docker-compose.yml passes every setting (Slack, GitLab sign-in, S3 and the tuning settings never reached the server before) and .env.example names them all. The image sets HOST explicitly.
