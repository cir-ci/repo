#!/usr/bin/env bash
# Publishes deploy/terraform as the Terraform Registry module's repository (cir-ci/terraform-docker-circi): the module's
# files at the mirror's root, one commit and one `v<version>` tag per CirCI release. Safe to rerun: a version whose
# tag exists is skipped.
#
# usage: scripts/sync-terraform-mirror.sh <version> <mirror-remote> [<message-author-name> <message-author-email>]
#   <mirror-remote> is a git URL (the release workflow uses SSH with the mirror's deploy key) or a local path, which is
#   how it is tested.
set -euo pipefail

version="${1:?usage: sync-terraform-mirror.sh <version> <mirror-remote>}"
remote="${2:?usage: sync-terraform-mirror.sh <version> <mirror-remote>}"
name="${3:-github-actions[bot]}"
email="${4:-41898282+github-actions[bot]@users.noreply.github.com}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
module="$root/deploy/terraform"
tag="v$version"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Not a release version: $version" >&2
  exit 1
fi

if git ls-remote --exit-code --tags "$remote" "refs/tags/$tag" > /dev/null 2>&1; then
  echo "The mirror already has $tag; nothing to do."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet "$remote" "$work/mirror" 2> /dev/null || git init --quiet "$work/mirror"
cd "$work/mirror"
git checkout --quiet -B main
git remote get-url origin > /dev/null 2>&1 || git remote add origin "$remote"

# Only the module's files; everything the module's folder holds locally (.terraform, state) stays out. The Caddyfile is
# a symlink to deploy/Caddyfile in the monorepo: the mirror gets the file itself (cp -L).
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
for file in main.tf variables.tf outputs.tf versions.tf Caddyfile; do
  cp -L "$module/$file" "$file"
done
mkdir tests
cp -L "$module"/tests/*.tftest.hcl tests/
sed "s/{{version}}/$version/g" "$root/deploy/terraform-mirror/README.md" > README.md
printf '%s\n' '.terraform/' '.terraform.lock.hcl' '*.tfstate' '*.tfstate.*' > .gitignore

git add -A
git -c user.name="$name" -c user.email="$email" commit --quiet --allow-empty \
  -m "CirCI $version" -m "Generated from cir-ci/repo (${GITHUB_SHA:-local})."
git tag "$tag"
git push --quiet origin main "$tag"
echo "Pushed $tag to the mirror."
