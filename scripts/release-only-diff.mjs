#!/usr/bin/env node
// Exits 0 when the commits since <base> only release what is already on it: the "Version Packages" diff
// that `pnpm version-packages` writes. Exits 1 (and names the files) when anything else changed. The gate
// job uses it on the release PR's branch to skip `pnpm gate:tests`: that code passed the gate on main, and
// a version bump of @circi/vitest changes every Turborepo hash (the root depends on it), so the tests
// would all run again for nothing. See .circleci/config.yml.
//
//   node scripts/release-only-diff.mjs [base] [head]    (defaults: origin/main, HEAD)
//
// A release-only change is one of:
//   - a deleted changeset (.changeset/<name>.md, not the README)
//   - a CHANGELOG.md, added or changed
//   - a package.json whose only difference is its "version"
//   - deploy/helm/circi/Chart.yaml with only `version:` and `appVersion:` changed (scripts/sync-chart-version.mjs)
// Anything else, the lockfile included, means the full gate.
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2)
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// Compared with the merge base, as a pull request is: commits that landed on main since don't count.
// With -z each change is two fields, its status and its path.
const fields = git('diff', '--name-status', '--no-renames', '-z', `${base}...${head}`)
  .split('\0')
  .filter(Boolean)
const changes = []
for (let i = 0; i < fields.length; i += 2) changes.push({ status: fields[i], path: fields[i + 1] })

const mergeBase = git('merge-base', base, head).trim()
const at = (ref, path) => git('show', `${ref}:${path}`)

const withoutVersion = (text) => {
  const { version: _, ...rest } = JSON.parse(text)
  return rest
}
const chartWithoutVersions = (text) =>
  text
    .split('\n')
    .filter((line) => !/^(version|appVersion):/.test(line))
    .join('\n')

function why(status, path) {
  if (/^\.changeset\/[^/]+\.md$/.test(path) && !path.endsWith('/README.md')) {
    return status === 'D' ? null : 'a changeset added or changed, not consumed'
  }
  if (/(^|\/)CHANGELOG\.md$/.test(path)) {
    return status === 'A' || status === 'M' ? null : 'a changelog removed'
  }
  if (/(^|\/)package\.json$/.test(path)) {
    if (status !== 'M') return 'a package.json added or removed'
    const same = isDeepStrictEqual(
      withoutVersion(at(mergeBase, path)),
      withoutVersion(at(head, path)),
    )
    return same ? null : 'changes besides "version"'
  }
  if (path === 'deploy/helm/circi/Chart.yaml') {
    if (status !== 'M') return 'the chart added or removed'
    const same = chartWithoutVersions(at(mergeBase, path)) === chartWithoutVersions(at(head, path))
    return same ? null : 'changes besides version and appVersion'
  }
  return 'not part of a release'
}

const problems = changes
  .map(({ status, path }) => ({ path, reason: why(status, path) }))
  .filter((c) => c.reason)

if (changes.length === 0) {
  console.log(`No changes since ${base}: run the full gate.`)
  process.exit(1)
}
if (problems.length > 0) {
  console.log(`Not a release-only diff since ${base}, so the full gate runs:`)
  for (const { path, reason } of problems) console.log(`  ${path}: ${reason}`)
  process.exit(1)
}
console.log(
  `Release-only diff since ${base} (${changes.length} files: versions, changelogs, consumed changesets).`,
)
