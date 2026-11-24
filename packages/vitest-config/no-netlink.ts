import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'no-netlink.c')

/**
 * The environment for an end-to-end Chromium (Playwright's, and Vitest's for the visual suite):
 * on Linux, the current one with `no-netlink.so` preloaded (see `no-netlink.c`); elsewhere
 * `undefined`, for the launcher's default.
 *
 * Why: on Linux, Chromium aborts every request in flight with `net::ERR_NETWORK_CHANGED` when an
 * interface or address on the host changes, and another end-to-end worker starting or stopping a
 * stack (its Docker network, its containers' veth pairs) is such a change. Pages lost their scripts
 * and never drew, lazily loaded pages failed, and Vitest could not import the visual test file.
 * Other hosts (Docker Desktop's VM on macOS) never show the browser those changes.
 *
 * The library is compiled once per source (named by its hash, written under a temporary name and
 * renamed, so concurrent workers never load a half-written file). Linux without a C compiler throws:
 * running the browsers unprotected would bring the flakiness back without a word.
 */
export function browserEnv(): Record<string, string> | undefined {
  if (process.platform !== 'linux') return undefined
  const library = noNetlinkLibrary()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env['LD_PRELOAD'] = [library, process.env['LD_PRELOAD']].filter(Boolean).join(':')
  return env
}

let built: string | undefined

function noNetlinkLibrary(): string {
  if (built) return built
  const source = readFileSync(SOURCE)
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const dir = join(tmpdir(), 'circi-e2e')
  const library = join(dir, `no-netlink-${hash}.so`)
  if (!existsSync(library)) {
    mkdirSync(dir, { recursive: true })
    const partial = `${library}.${process.pid}.tmp`
    try {
      execFileSync('cc', ['-shared', '-fPIC', '-O2', '-o', partial, SOURCE, '-ldl'], {
        stdio: 'pipe',
      })
    } catch (err) {
      throw new Error(
        `Couldn't compile ${SOURCE} (needs a C compiler, \`cc\`): the end-to-end browsers need it on Linux.`,
        { cause: err },
      )
    }
    renameSync(partial, library)
  }
  built = library
  return library
}
