import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { type DiffEngine, REPO_ROOT, serverEnv } from './config.ts'

const exec = promisify(execFile)

const SERVER_MAIN = join(REPO_ROOT, 'apps', 'server', 'src', 'main.ts')

/**
 * `circi <args>` against the perf database, from source like dev/src/seed.ts: the built bundle's
 * `admin project create` exits before it prints (see README.md, "Known problems"). The server and
 * the worker that are measured always run from the bundle.
 */
export async function circi(args: string[], engine?: DiffEngine): Promise<string> {
  const { stdout } = await exec(
    process.execPath,
    ['--conditions=@circi/source', SERVER_MAIN, ...args],
    { env: { ...process.env, ...serverEnv(engine) }, maxBuffer: 16 * 1024 * 1024 },
  )
  return stdout
}
