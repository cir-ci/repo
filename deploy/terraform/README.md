# deploy/terraform

The Terraform module that runs a released CirCI on one Docker host: the app, Postgres unless `database` is given, and
Caddy when `caddy` is set. Using it (the inputs, updating, Amazon RDS, registries) is on the website:
[Terraform](https://circi.dev/self-hosting/terraform/). This file is about how the module is built.

## How it's built

- **`variables.tf`: settings in groups.** The server's settings come in groups (`smtp`, `s3`, `sso`, `jobs`, ...), each
  key named after its setting (`smtp.host` is `SMTP_HOST`). The groups, `caddy` and `database` are typed `any` and
  checked key by key in their `validation` blocks, because an object type would drop a misspelled key without a
  word. Each validation lists its group's keys and their types; the variable's description is where a key's
  setting and default are written down.
- **Secrets are variables of their own**, named after the setting in lower case and marked `sensitive`. They reach
  the container as files under `/run/circi/secrets/`, named by `<NAME>_FILE` (read by `@circi/config`), so the plan
  shows the rest of the environment in plain text.
- **`main.tf`: locals mirror the variables.** Each group has a local listing every key with its default (null unless
  the module has one) merged with the input, and the `circi` container's `env` names each setting next to the value it
  takes (`SMTP_HOST = local.smtp.host`), leaving out what's null. `local.secrets` is the one map from a variable to a
  setting's name, because the uploads loop over it.
- **Settings that go together** are listed once, in `local.setting_groups` (by their values, so the plan's message
  names the variables), and checked by one precondition on the container.
- **The Docker network's gateway is set explicitly** (`cidrhost(network_subnet, 1)`): Docker picks it otherwise, and
  the provider reads that as a change that replaces the network and every container on it.

## What keeps it in step with the server

`@circi/config`'s lists (`packages/config/src/settings.ts`: every setting, the secrets, what the image sets, the
groups that go together) are what the module is checked against. `packages/config/test/deploy-settings.test.ts`, in
`pnpm test`, fails when:

- a setting isn't passed, or a secret isn't passed as a file;
- the sensitive variables aren't exactly the secrets (plus `postgres_password`, `database_password` and
  `caddy_aws_credentials`);
- `local.setting_groups` doesn't check the same groups as `SETTING_GROUPS`;
- a setting is missing from the wiring case in `tests/`.

A new server setting therefore needs a key in a group (validation, description, local), a line in the container's
`env`, and a value in the wiring case.

## Tests

`pnpm test:terraform` runs `terraform test` here (the CI job `terraform` too): `tests/settings.tftest.hcl` plans the
module against a mocked Docker provider, so no Docker is needed, and checks what reaches the containers. One case sets
every setting and expects each under its own name; others cover the bundled and external Postgres, TLS, Caddy, the
groups that go together, misspelled keys and wrong types.

## The registry mirror

The Terraform Registry wants a repository of its own with the module at its root and `vX.Y.Z` tags, so
[cir-ci/terraform-docker-circi](https://github.com/cir-ci/terraform-docker-circi) (registry address `cir-ci/circi/docker`)
is a generated mirror of this folder, and nothing is edited there. The `terraform-mirror` job of
`.github/workflows/release.yml` runs `scripts/sync-terraform-mirror.sh <version> <remote>` after each app release's image
is published. The script clones the mirror, replaces its contents with the module's files (`main.tf`, `variables.tf`,
`outputs.tf`, `versions.tf`, `Caddyfile`, `tests/`), writes its README from `deploy/terraform-mirror/README.md` (the
registry page: a usage example and a link to the website), commits as github-actions, pushes `main` and tags
`v<version>`. A version whose tag exists is skipped, so a rerun does nothing. The job pushes over SSH with a deploy key
of the mirror: its public key is on the mirror with write access, and its private key is the `TERRAFORM_MIRROR_DEPLOY_KEY`
secret here, so it can push to that one repository and is tied to no one's account. Without the secret the job only
prints a notice. To set it up or rotate it: `ssh-keygen -t ed25519 -N '' -C terraform-mirror -f mirror_key`, add
`mirror_key.pub` to the mirror (Settings › Deploy keys, Allow write access), save `mirror_key` as the secret, and
delete both files.

`Caddyfile` here is a symlink to `../Caddyfile`, the one file the Docker Compose overlay also mounts. The module reads a
file inside its own folder (`file("${path.module}/Caddyfile")`), so it works from the monorepo's Git source too, and the
sync copies the file dereferenced, so the mirror holds a real one. To try the script, pass a local bare repository as the
remote, then run `terraform init -backend=false` and `terraform test` in a clone of it.
