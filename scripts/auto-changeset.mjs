#!/usr/bin/env node
// Runs from the husky post-commit hook. When the commit just made changes a workspace package and
// adds no changeset, it writes one from the commit message and amends it into the same commit, so
// `changeset status` in CI finds one for every changed package without anyone remembering
// `pnpm changeset`. The note is the commit's subject: rewrite it into a release note for the people
// who use what changed (CLAUDE.md).
//
// The bump is a patch, unless the message carries `[minor]` or `[major]` (the marker is left out of
// the note). Skipped while rebasing, merging or cherry-picking, for the release PR's "Version
// Packages" commit, and with CIRCI_AUTO_CHANGESET=0. pnpm decides what changed: every package whose
// files or catalog versions the commit changed, private ones included (every package is versioned),
// and, for a published package (@circi/cli, @circi/vitest), the published packages that depend on it
// (a CLI change also releases @circi/vitest, which bundles it). Private dependents are left out: CI
// asks for a changeset only for the packages that changed.
//
// The app is released too: its version is @circi/server's, the tag of the image the release workflow
// publishes. The image holds the server (and everything it depends on), the dashboard, and what
// deploy/ builds and runs it with, so a change to any of those releases the app.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

if (process.env.CIRCI_AUTO_CHANGESET === '0' || process.env.CIRCI_AUTO_CHANGESET_RUNNING) {
  process.exit(0)
}

const root = git('rev-parse', '--show-toplevel')
const gitDir = git('rev-parse', '--absolute-git-dir')
const busy = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
if (busy.some((name) => existsSync(join(gitDir, name)))) process.exit(0)

const message = git('log', '-1', '--format=%B')
const subject = message.split('\n')[0] ?? ''
if (/^Version Packages\b/.test(subject)) process.exit(0)

const changed = git('diff-tree', '--no-commit-id', '--name-only', '--root', '-r', 'HEAD').split(
  '\n',
)
if (changed.some((path) => /^\.changeset\/(?!README\.md$|config\.json$).+\.md$/.test(path))) {
  process.exit(0)
}

// Most commits touch no package, catalog or lockfile: no need to start pnpm for those. The folders
// are pnpm-workspace.yaml's packages, plus deploy/ (part of the app's image, in no package).
const relevant =
  /^(apps|packages|e2e|dev|perf|deploy)\/|^(pnpm-workspace\.yaml|pnpm-lock\.yaml|package\.json)$/
if (!changed.some((path) => relevant.test(path))) process.exit(0)

// `HEAD^...HEAD`, not `[HEAD^]`: that one also counts uncommitted edits in the working tree.
// `[…]` is what the commit changed, `...[…]` adds what depends on it, devDependencies included: the
// bundles (the server's, @circi/vitest's) inline workspace packages they list as devDependencies. So
// a CLI change also lists the app (the server's tests use the CLI): drop it from the note.
const list = (filter) =>
  JSON.parse(
    execFileSync('pnpm', ['list', '--recursive', '--filter', filter, '--depth', '-1', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ).filter((pkg) => pkg.path !== root) // the repository's root is no package of the workspace
let changedPackages, withDependents
try {
  changedPackages = list('[HEAD^...HEAD]')
  withDependents = list('...[HEAD^...HEAD]')
} catch {
  process.exit(0) // the first commit (no HEAD^), or pnpm unavailable: nothing to compare
}
const touched = new Set([
  ...changedPackages.map((pkg) => pkg.name),
  ...withDependents.filter((pkg) => !pkg.private).map((pkg) => pkg.name),
])
// The dashboard ships inside the app's image without being a dependency of the server; deploy/ is
// in no package at all.
const app = new Set(['@circi/server', '@circi/web'])
if (
  withDependents.some((pkg) => app.has(pkg.name)) ||
  changed.some((path) => path.startsWith('deploy/'))
) {
  touched.add('@circi/server')
}
if (touched.size === 0) process.exit(0)

const bump = /\[major\]/i.test(message) ? 'major' : /\[minor\]/i.test(message) ? 'minor' : 'patch'
const note = subject.replace(/\s*\[(major|minor|patch)\]\s*/gi, ' ').trim() || 'Update'
const sha = git('rev-parse', '--short', 'HEAD')
const file = join(root, '.changeset', `auto-${sha}.md`)
const frontmatter = [...touched]
  .toSorted((a, b) => a.localeCompare(b))
  .map((name) => `'${name}': ${bump}`)
writeFileSync(file, `---\n${frontmatter.join('\n')}\n---\n\n${note}\n`)

execFileSync('git', ['add', file])
execFileSync('git', ['commit', '--amend', '--no-edit', '--no-verify'], {
  env: { ...process.env, CIRCI_AUTO_CHANGESET_RUNNING: '1' },
  stdio: 'inherit',
})
console.log(`[changeset] added .changeset/auto-${sha}.md (${bump}: ${[...touched].join(', ')})`)
