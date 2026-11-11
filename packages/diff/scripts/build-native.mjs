// Compiles the native pixel comparison (packages/diff/native) in release mode for this machine and
// copies it to native/circi-diff.node, where `@circi/diff` (and the server bundle's copy step)
// look for it. Without a Rust toolchain it does nothing and exits 0: the JS engine is the default.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const crate = join(import.meta.dirname, '..', 'native')
const cargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' })
if (cargo.error || cargo.status !== 0) {
  console.log(
    '@circi/diff: cargo not found, skipping the native engine (CIRCI_DIFF_ENGINE=js works)',
  )
  process.exit(0)
}
const build = spawnSync('cargo', ['build', '--release', '--locked'], {
  cwd: crate,
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const library =
  { darwin: 'libcirci_diff_native.dylib', win32: 'circi_diff_native.dll' }[process.platform] ??
  'libcirci_diff_native.so'
const from = join(crate, 'target', 'release', library)
if (!existsSync(from)) {
  console.error(`@circi/diff: expected ${from} after the build`)
  process.exit(1)
}
copyFileSync(from, join(crate, 'circi-diff.node'))
console.log('@circi/diff: built native/circi-diff.node')
