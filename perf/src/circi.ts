import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { type DiffEngine, SERVER_BUNDLE, serverEnv } from './config.ts'

const exec = promisify(execFile)

/**
 * `circi <args>` against the perf database, from the built bundle, as an operator runs it in the
 * image. The seed runs after the build step, like the server and the worker that are measured.
 */
export async function circi(args: string[], engine?: DiffEngine): Promise<string> {
  const { stdout } = await exec(process.execPath, [SERVER_BUNDLE, ...args], {
    env: { ...process.env, ...serverEnv(engine) },
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}
