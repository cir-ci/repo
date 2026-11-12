import { execFile, spawnSync } from 'node:child_process'

export namespace run {
  export interface Options {
    cwd?: string
    env?: Record<string, string | undefined>
    /** Milliseconds before the process is killed (default 5 minutes). */
    timeoutMs?: number
    /** Resolve instead of throwing on a non-zero exit. */
    allowFail?: boolean
    input?: string
  }

  export interface Result {
    stdout: string
    stderr: string
    /** Exit code (0 on success). */
    code: number
  }
}

/** Runs a command and collects its output; throws a readable error unless `allowFail`. */
export function run(
  command: string,
  args: string[],
  options: run.Options = {},
): Promise<run.Result> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs ?? 300_000,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        if (error && !options.allowFail) {
          reject(
            new Error(
              `${command} ${args.join(' ')} failed (${error.killed ? 'timed out' : `exit ${code}`})\n${stderr || stdout || error.message}`,
            ),
          )
          return
        }
        resolve({ stdout, stderr, code })
      },
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

/**
 * Throws a clear error (fast: five seconds) when there is no Docker daemon, instead of letting the
 * first `docker compose` call hang or fail obscurely.
 */
export function assertDocker(): void {
  const probe = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    timeout: 8_000,
  })
  if (probe.error || probe.status !== 0) {
    const why = probe.error
      ? probe.error.message
      : (probe.stderr.trim().split('\n').at(-1) ?? 'docker info failed')
    throw new Error(
      `The end-to-end tests need a running Docker daemon, and "docker info" failed: ${why}\n` +
        'Start Docker (Docker Desktop, OrbStack, colima ...) and run `pnpm test:e2e` again.',
    )
  }
  const compose = spawnSync('docker', ['compose', 'version', '--short'], {
    encoding: 'utf8',
    timeout: 8_000,
  })
  if (compose.error || compose.status !== 0) {
    throw new Error('The end-to-end tests need the Docker Compose v2 plugin ("docker compose").')
  }
}

/** Prefix of every compose project this run creates; `down`ed by the run's teardown. */
export function runPrefix(runId: string): string {
  return `circi-e2e-${runId}-`
}

/**
 * Every e2e compose project on this machine. Read from containers, networks and volumes alike: a
 * stack whose `up` failed half-way can own a network and no container.
 */
export function listE2eProjectsSync(): string[] {
  const label = '{{.Label "com.docker.compose.project"}}'
  const projects = new Set<string>()
  for (const args of [
    ['ps', '-a', '--format', label],
    ['network', 'ls', '--format', label],
    ['volume', 'ls', '--format', label],
  ]) {
    const out = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 })
    for (const line of (out.stdout ?? '').split('\n')) {
      if (line.trim().startsWith('circi-e2e-')) projects.add(line.trim())
    }
  }
  return [...projects]
}

/** Removes every compose project of a run (containers, networks, volumes). Synchronous: used in exit handlers. */
export function removeRunProjectsSync(runId: string): string[] {
  const projects = listE2eProjectsSync().filter((p) => p.startsWith(runPrefix(runId)))
  for (const project of projects) removeProjectSync(project)
  return projects
}

/** Removes one compose project (containers, networks, volumes). Synchronous: used in exit handlers. */
export function removeProjectSync(project: string): void {
  spawnSync('docker', ['compose', '-p', project, 'down', '-v', '--remove-orphans', '-t', '2'], {
    timeout: 120_000,
  })
}
