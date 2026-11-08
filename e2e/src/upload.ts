import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { run } from './docker.ts'
import { GIT_ENV, type Repo } from './git-repo.ts'
import { CLI_MAIN, E2E_ROOT, REPO_ROOT } from './paths.ts'
import type { Stack } from './stack.ts'

export namespace uploadOrThrow {
  /** What `circi upload --json` prints (the fields tests usually need; the rest is passed through). */
  export interface Result {
    build: { id: string; number: number; [key: string]: unknown }
    uploaded: number
    deduplicated: number
    ci: {
      provider: string
      commitSha: string
      branch?: string
      prNumber?: number
      [key: string]: unknown
    }
    ancestry?: unknown
    status?: {
      build: { id: string; status: string; reviewStatus?: string; [key: string]: unknown }
      counts: {
        added: number
        changed: number
        removed: number
        unchanged: number
        total: number
        [key: string]: unknown
      }
      outcome?: { state: string; summary: string; [key: string]: unknown }
      [key: string]: unknown
    }
    exitCode: number
    [key: string]: unknown
  }
}

export namespace uploadBuild {
  export interface Options {
    stack: Pick<Stack, 'url'>
    /** The team's CI token. */
    token: string
    repo: Repo
    /** Folder to upload (default: the repo's `screenshots/`). */
    dir?: string
    name?: string
    /** Wait for the worker and exit 1 when changes block the merge. */
    wait?: boolean
    /** `n/total`, e.g. `1/2`. */
    shard?: string
    gate?: 'status' | 'exit-code'
    /** Pull request number and base branch (sets CIRCI_PR_NUMBER / CIRCI_BASE_BRANCH). */
    pr?: { number: number; base?: string }
    /** Extra environment (e.g. CIRCI_BRANCH, GITHUB_RUN_ID). */
    env?: Record<string, string>
    /** Extra CLI arguments. */
    args?: string[]
    timeoutSeconds?: number
  }

  export interface Run {
    exitCode: number
    stdout: string
    stderr: string
    /** Parsed `--json` output, when the command printed some. */
    result: uploadOrThrow.Result | undefined
  }
}

/** Rebuilds the CLI when its sources are newer than `dist/main.mjs` (or its build config); throws if it can't. */
export async function ensureCliBuilt(): Promise<void> {
  const newest = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((max, e) => {
      const p = join(dir, e.name)
      return Math.max(max, e.isDirectory() ? newest(p) : statSync(p).mtimeMs)
    }, 0)
  const cli = join(REPO_ROOT, 'packages', 'cli')
  const inputs = Math.max(
    newest(join(cli, 'src')),
    statSync(join(cli, 'tsdown.config.ts')).mtimeMs,
    statSync(join(cli, 'package.json')).mtimeMs,
  )
  if (!existsSync(CLI_MAIN) || statSync(CLI_MAIN).mtimeMs < inputs) {
    await run('pnpm', ['--filter', '@circi/cli', 'build'], { cwd: REPO_ROOT, timeoutMs: 180_000 })
  }
}

/** Environment for the CLI: git identity, no CI provider detected, only what the test sets. */
function cliEnv(options: uploadBuild.Options): Record<string, string> {
  const base: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
    const value = process.env[key]
    if (value) base[key] = value
  }
  return {
    ...base,
    ...GIT_ENV,
    CIRCI_TOKEN: options.token,
    CIRCI_API_URL: options.stack.url,
    NODE_OPTIONS: `--import ${join(E2E_ROOT, 'src', 'dns-preload.ts')}`,
    ...(options.pr
      ? {
          CIRCI_PR_NUMBER: String(options.pr.number),
          CIRCI_BASE_BRANCH: options.pr.base ?? 'main',
        }
      : {}),
    ...options.env,
  }
}

/** Runs the real, built `circi` CLI (`packages/cli/dist/main.mjs`) with an arbitrary command line. */
export function runCli(
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_MAIN, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += String(c)))
    child.stderr.on('data', (c) => (stderr += String(c)))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`circi ${args.join(' ')} timed out\n${stderr}`))
    }, options.timeoutMs ?? 300_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

/**
 * `circi upload <dir> --json` from inside the repo, as CI would run it. Does not throw on a
 * non-zero exit: tests assert on `exitCode` (1 means visual changes block the merge).
 */
export async function uploadBuild(options: uploadBuild.Options): Promise<uploadBuild.Run> {
  await ensureCliBuilt()
  const args = [
    'upload',
    options.dir ?? options.repo.shots,
    '--json',
    ...(options.name ? ['--name', options.name] : []),
    ...(options.wait ? ['--wait', '--timeout', String(options.timeoutSeconds ?? 120)] : []),
    ...(options.shard ? ['--shard', options.shard] : []),
    ...(options.gate ? ['--gate', options.gate] : []),
    ...(options.args ?? []),
  ]
  const out = await runCli(args, { cwd: options.repo.dir, env: cliEnv(options) })
  let result: uploadOrThrow.Result | undefined
  try {
    result = JSON.parse(out.stdout) as uploadOrThrow.Result
  } catch {
    result = undefined
  }
  return { ...out, result }
}

/** Like `uploadBuild` but throws unless the upload itself worked (exit 0 or 1) and printed a result. */
export async function uploadOrThrow(
  options: uploadBuild.Options,
): Promise<uploadOrThrow.Result & { run: uploadBuild.Run }> {
  const out = await uploadBuild(options)
  if (!out.result || out.exitCode > 1) {
    throw new Error(`circi upload failed (exit ${out.exitCode})\n${out.stderr}\n${out.stdout}`)
  }
  return { ...out.result, run: out }
}
