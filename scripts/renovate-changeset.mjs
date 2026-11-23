#!/usr/bin/env node
// Renovate's post-upgrade task (.github/renovate.json): writes the changeset for a Renovate branch,
// which Renovate then commits with its update, so a dependency update releases what it changes like
// any other change does (CLAUDE.md: every changed package gets a changeset).
//
// Renovate passes the branch's updates in the file RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE names
// (renovate.json's dataFileTemplate): { "branch": "...", "upgrades": [{ depName, currentVersion,
// newVersion, packageFile }] }. A package gets a patch when it uses an updated dependency: in its
// dependencies, peerDependencies or optionalDependencies, or in its devDependencies when it's built
// with tsdown or Vite (the bundles inline what they list there), or when the updated file is in its
// folder (a Cargo.toml, say). A bundled package that lists such a package gets one too, since it
// inlines it; a package that merely depends on it doesn't (as with scripts/auto-changeset.mjs, CI
// asks only for the packages that changed). The app's image holds the server, the dashboard and
// deploy/, so those release @circi/server.
// An update nothing uses (the root's tools, CI images) writes no changeset.
//
// The file is named after the branch, so a rebase rewrites it rather than adding another.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dataFile = process.env.RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE
if (!dataFile) throw new Error('RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE is not set')
const data = JSON.parse(readFileSync(dataFile, 'utf8'))
const upgrades = (data.upgrades ?? []).filter((u) => u.depName && u.newVersion)

// pnpm-workspace.yaml's `packages:` list: plain folders, or `dir/*`.
const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
const globs = [
  ...(workspace.match(/^packages:\n((?:\s+- .+\n)+)/m)?.[1] ?? '').matchAll(/- (.+)/g),
].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''))
const dirs = globs.flatMap((glob) =>
  glob.endsWith('/*')
    ? readdirSync(join(root, glob.slice(0, -2)), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${glob.slice(0, -2)}/${d.name}`)
    : [glob],
)
const packages = dirs
  .filter((dir) => existsSync(join(root, dir, 'package.json')))
  .map((dir) => ({ dir, json: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) }))

const RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies']
const bundles = (pkg) => /\b(tsdown|vite build)\b/.test(pkg.json.scripts?.build ?? '')
const lists = (pkg, name, fields) => fields.some((field) => pkg.json[field]?.[name] !== undefined)
const uses = (pkg, name) =>
  lists(pkg, name, RUNTIME) || (bundles(pkg) && lists(pkg, name, ['devDependencies']))

const touched = new Set()
for (const u of upgrades) {
  for (const pkg of packages) {
    const inFolder = u.packageFile?.startsWith(`${pkg.dir}/`)
    if (inFolder || uses(pkg, u.depName)) touched.add(pkg.json.name)
  }
  if (u.packageFile?.startsWith('deploy/')) touched.add('@circi/server')
}
// A bundle that inlines a touched package changes with it.
for (let grew = true; grew;) {
  grew = false
  for (const pkg of packages) {
    if (touched.has(pkg.json.name) || !bundles(pkg)) continue
    if ([...touched].some((name) => lists(pkg, name, [...RUNTIME, 'devDependencies']))) {
      touched.add(pkg.json.name)
      grew = true
    }
  }
}
if (touched.has('@circi/web')) touched.add('@circi/server')

const slug = String(data.branch ?? 'update').replace(/[^\w-]+/g, '-')
const file = join(root, '.changeset', `renovate-${slug}.md`)
if (touched.size === 0) {
  rmSync(file, { force: true })
  process.exit(0)
}
const names = [...touched].toSorted((a, b) => a.localeCompare(b))
const updated = upgrades.map((u) =>
  u.currentVersion
    ? `${u.depName} from ${u.currentVersion} to ${u.newVersion}`
    : `${u.depName} to ${u.newVersion}`,
)
const note = `Dependency update: ${updated.join(', ')}.`
writeFileSync(file, `---\n${names.map((n) => `'${n}': patch`).join('\n')}\n---\n\n${note}\n`)
console.log(`[renovate] wrote .changeset/renovate-${slug}.md (${names.join(', ')})`)
