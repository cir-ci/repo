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
is a copy of this folder, made by the `terraform-mirror` job of `.github/workflows/release.yml` on each app release and
never edited by hand. Its README is `deploy/terraform-mirror/README.md` (the registry page), not this file.

`Caddyfile` here is a symlink to `../Caddyfile`, the one file the Docker Compose overlay also mounts: the module reads a
file in its own folder, which works from the monorepo's Git source, and the job's `rsync -L` gives the mirror a real file.

Setting it up once (or rotating the key):

1. The mirror needs one commit before the first release (`actions/checkout` can't check out an empty repository); the
   first release replaces it.
2. A deploy key: `ssh-keygen -t ed25519 -N '' -C terraform-mirror -f mirror_key`. Add `mirror_key.pub` to the mirror
   (Settings › Deploy keys, Allow write access), save `mirror_key` as the `TERRAFORM_MIRROR_DEPLOY_KEY` Actions secret
   here, and delete both files. Without the secret the job only prints a notice.
3. Publish the mirror once at [registry.terraform.io](https://registry.terraform.io) (sign in with GitHub, Publish ›
   Module, `cir-ci/terraform-docker-circi`); the registry then picks up every new `v*` tag.
