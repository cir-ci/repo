#!/usr/bin/env node
// Runs from the husky post-commit hook. When the commit just made changes a published package
// (@circi/cli, @circi/vitest) and adds no changeset, it writes one from the commit message and
// amends it into the same commit, so every release note exists without anyone remembering
// `pnpm changeset`.
//
// The bump is a patch, unless the message carries `[minor]` or `[major]` (the marker is left out of
// the note). Skipped while rebasing, merging or cherry-picking, for the release PR's "Version
// Packages" commit, and with CIRCI_AUTO_CHANGESET=0. pnpm decides what changed: a package whose
// files or catalog versions the commit changed, and every package that depends on one (so a CLI
// change also releases @circi/vitest, which bundles it).
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

// Most commits touch no package, catalog or lockfile: no need to start pnpm for those.
const relevant = /^(apps|packages)\/|^(pnpm-workspace\.yaml|pnpm-lock\.yaml|package\.json)$/
if (!changed.some((path) => relevant.test(path))) process.exit(0)

// The published (not private) packages the commit changed, and those that depend on them.
// `HEAD^...HEAD`, not `[HEAD^]`: that one also counts uncommitted edits in the working tree.
let selected
try {
  const out = execFileSync(
    'pnpm',
    ['list', '--recursive', '--filter', '...[HEAD^...HEAD]', '--depth', '-1', '--json'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  selected = JSON.parse(out)
} catch {
  process.exit(0) // the first commit (no HEAD^), or pnpm unavailable: nothing to compare
}
const touched = new Set(selected.filter((pkg) => !pkg.private).map((pkg) => pkg.name))
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
