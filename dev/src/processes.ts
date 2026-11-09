import { type ChildProcess, spawn } from 'node:child_process'
import { connect } from 'node:net'
import { createInterface } from 'node:readline'

import { REPO_ROOT } from './config.ts'

export namespace run {
  export interface Options {
    env?: Record<string, string>
    cwd?: string
    /** Print the output as it comes instead of capturing it. */
    inherit?: boolean
  }
}

/** Runs a command to completion; rejects with its output when it fails. Resolves stdout. */
export function run(command: string, args: string[], options: run.Options = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c) => (stdout += String(c)))
    child.stderr?.on('data', (c) => (stderr += String(c)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${stderr || stdout}`))
    })
  })
}

const COLORS = { server: 36, web: 35, seed: 33, dev: 32 } as const

/** A `[name]` prefix, coloured when the terminal supports it. */
export function tag(name: keyof typeof COLORS): string {
  const label = `[${name}]`.padEnd(8)
  return process.stdout.isTTY ? `\u001b[${COLORS[name]}m${label}\u001b[0m` : label
}

export function log(name: keyof typeof COLORS, line: string): void {
  console.log(`${tag(name)} ${line}`)
}

/** Starts a long-running process whose output lines are prefixed with its name. */
export function start(
  name: keyof typeof COLORS,
  command: string,
  args: string[],
  env: Record<string, string> = {},
  cwd = REPO_ROOT,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => log(name, line))
  }
  return child
}

/** Polls a URL until it answers 2xx, or throws after `timeoutMs`. */
export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = 'no answer'
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling: one attempt at a time
      const res = await fetch(url)
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    // oxlint-disable-next-line no-await-in-loop -- polling: one attempt at a time
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} did not become ready within ${timeoutMs / 1000}s (${last})`)
}

/** True when something already accepts connections on `port` (IPv4 or IPv6 loopback). */
export async function isPortTaken(port: number): Promise<boolean> {
  const tryHost = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ port, host })
      socket.setTimeout(1000)
      socket.once('connect', () => (socket.destroy(), resolve(true)))
      socket.once('timeout', () => (socket.destroy(), resolve(false)))
      socket.once('error', () => resolve(false))
    })
  return (await tryHost('127.0.0.1')) || (await tryHost('::1'))
}

/**
 * Which process listens on `port`, as `lsof` prints it (command, pid, user), or null when nothing
 * does or `lsof` is not installed (Windows, minimal containers): the caller just skips the line.
 */
export async function portHolder(port: number): Promise<string | null> {
  try {
    const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

export namespace explainPortTaken {
  export interface Input {
    /** What wanted the port: "the server", "the dashboard (Vite)". */
    what: string
    port: number
    /** The variable that picks another port. */
    envVar: string
  }
}

/** The lines to print when `what` could not start because `port` is taken. */
export async function explainPortTaken({
  what,
  port,
  envVar,
}: explainPortTaken.Input): Promise<string[]> {
  const holder = await portHolder(port)
  return [
    `Port ${port} is already in use, so ${what} cannot start.`,
    ...(holder ? ['It is held by:', ...holder.split('\n').map((line) => `  ${line}`)] : []),
    `Stop that process, or pick another port: ${envVar}=<port> pnpm dev`,
  ]
}
