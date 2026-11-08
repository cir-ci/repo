import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeRunProjectsSync, run } from './docker.ts'
import { Mailbox } from './mail.ts'
import { ARTIFACTS_DIR, COMPOSE_FILE } from './paths.ts'
import { S3_ACCESS_KEY, S3_BUCKET, S3_SECRET_KEY, S3Bucket } from './s3.ts'

export namespace Stack {
  export interface Options {
    /** Where CirCI keeps screenshots: its local volume (default) or the LocalStack bucket. */
    storage?: 'fs' | 's3'
    /** Extra environment for the `circi` container; wins over everything the harness sets. */
    env?: Record<string, string>
    /**
     * The static-sites domain (`STATIC_SITES_HOST`), e.g. `sites.localhost`: Chrome resolves
     * `*.localhost` to loopback by itself. It must not be related to the dashboard's host, so with
     * this set the dashboard is `http://127.0.0.1:<port>` instead of `http://localhost:<port>`.
     */
    sitesHost?: string
    /** Start LocalStack although the storage is local (e.g. to test `storage migrate`). */
    localstack?: boolean
    /** Names the test file in the timing summary (`useStack` sets it). */
    label?: string
    /** The shared profile this stack serves (set by the pool, shown in the timing summary). */
    profile?: string
    /** The pool reports the boot itself (the stack lives on after any one file): `stop()` stays silent. */
    pooled?: boolean
  }

  export type Service = 'circi' | 'postgres' | 'mailpit' | 'localstack'
}

export interface Stack {
  /** The dashboard / API address as the browser and the CLI use it (`PUBLIC_URL`). */
  url: string
  /** Compose project name: `docker compose -p <project> ...` works while the stack is up. */
  composeProject: string
  ports: { http: number; mail: number; s3: number | undefined }
  storage: 'fs' | 's3'
  sitesHost: string | undefined
  mail: Mailbox
  /** The bucket, when the stack has LocalStack (storage `s3`, or `localstack: true`). */
  s3: S3Bucket | undefined
  /** The address a container reaches host-run fakes at is `http://host.docker.internal:<port>`. */
  hostFromContainers: string
  /** Runs a command in a service's container. Throws on a non-zero exit unless `allowFail`. */
  exec(
    service: Stack.Service,
    command: string[],
    options?: { allowFail?: boolean; timeoutMs?: number },
  ): Promise<run.Result>
  /** `circi admin ...` in the app container; returns stdout (trimmed). */
  cli(...args: string[]): Promise<string>
  /** The code first-run setup asks for. */
  setupCode(): Promise<string>
  /** Runs SQL in the database; returns rows as arrays of text columns. */
  sql(query: string): Promise<string[][]>
  logs(service: Stack.Service, options?: { tail?: number }): Promise<string>
  /** Writes every service's log to `e2e/.artifacts/<project>/`. Returns the folder. */
  saveLogs(): Promise<string>
  /** Recreates the app container after `docker compose stop`, restart etc. */
  restart(service: Stack.Service): Promise<void>
  /**
   * Recreates the app container with `env` merged over the environment the stack started with
   * (e.g. `s3Env(stack)` to switch from local disk to S3). Volumes and the database stay.
   */
  reconfigure(env: Record<string, string>): Promise<void>
  /** Background jobs: the queue is Postgres (`jobs` table), the worker runs inside the circi container. */
  jobs: {
    /**
     * Makes pending jobs of `queue` due now (a retry with backoff then does not have to be waited
     * out) and returns how many it moved. `filter` narrows by payload fields, e.g.
     * `{ webhookId }`. Jobs that are running, done or failed are left alone.
     */
    runNow(queue: string, filter?: Record<string, string>): Promise<number>
  }
  /** How long each phase of this stack took, in milliseconds (`setup` is filled in by `useStack`). */
  phases: { up: number; healthy: number; setup?: number; teardown?: number }
  stop(): Promise<void>
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`

let counter = 0

function runId(): string {
  // global-setup sets it for the whole run; a stack started outside vitest makes its own.
  process.env['E2E_RUN_ID'] ??= randomBytes(3).toString('hex')
  return process.env['E2E_RUN_ID']
}

const keep = () => Boolean(process.env['E2E_KEEP'])

const seconds = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`)

/** One line per stack, printed when it is removed, and one JSON line for the run's timing summary. */
export function reportPhases(
  project: string,
  phases: Stack['phases'],
  file: string | undefined,
  profile?: string,
): void {
  process.stderr.write(
    `[e2e] ${project}: compose up ${seconds(phases.up)}, healthy ${seconds(phases.healthy)}, ` +
      `setup ${seconds(phases.setup)}, teardown ${seconds(phases.teardown)}\n`,
  )
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true })
    appendFileSync(
      join(ARTIFACTS_DIR, 'stack-phases.jsonl'),
      `${JSON.stringify({ project, file, profile, ...phases })}\n`,
    )
  } catch {
    // timings are best effort
  }
}

/**
 * Starts a fresh stack (Postgres, Mailpit, optionally LocalStack, and CirCI from the `circi:e2e`
 * image) under its own compose project and free host ports, and waits until it is healthy.
 * Several can run at once, in one process or on one machine. `stop()` removes it and its volumes.
 */
export async function startStack(options: Stack.Options = {}): Promise<Stack> {
  const storage = options.storage ?? 'fs'
  const withS3 = storage === 's3' || options.localstack === true
  counter += 1
  const project = `circi-e2e-${runId()}-${counter}-${randomBytes(2).toString('hex')}`
  const dir = await mkdtemp(join(tmpdir(), `${project}-`))

  // Docker picks every host port when the container starts; they are read back after `up`. The
  // dashboard's address is needed in circi's environment, so `edge` (which owns its port) starts
  // first and circi after it.
  let http = 0
  let mail = 0
  let s3Port: number | undefined
  let url = 'http://localhost'

  const environment: Record<string, string> = { ...options.env }
  const override = join(dir, 'override.json')
  const composeEnv: Record<string, string> = {
    E2E_PUBLIC_URL: url,
    COMPOSE_PROFILES: withS3 ? 's3' : '',
    COMPOSE_PROJECT_NAME: project,
  }
  const writeOverride = () =>
    writeFileSync(override, JSON.stringify({ services: { circi: { environment } } }))
  writeOverride()
  const compose = (args: string[], extra: { allowFail?: boolean; timeoutMs?: number } = {}) =>
    run('docker', ['compose', '-f', COMPOSE_FILE, '-f', override, ...args], {
      env: composeEnv,
      ...extra,
    })
  const publishedPort = async (service: string, containerPort: number): Promise<number> => {
    const res = await compose(['port', service, String(containerPort)], { timeoutMs: 30_000 })
    // "127.0.0.1:49153", or "[::]:49153", possibly one line per address family.
    const port = Number(res.stdout.trim().split('\n')[0]?.split(':').at(-1))
    if (!Number.isInteger(port) || port < 1) {
      throw new Error(`docker compose port ${service} ${containerPort} printed "${res.stdout}"`)
    }
    return port
  }

  let mailbox: Mailbox | undefined
  let bucket: S3Bucket | undefined
  let stopped = false
  const phases: Stack['phases'] = { up: 0, healthy: 0 }

  const logs = async (service: Stack.Service, o: { tail?: number } = {}) => {
    const res = await compose(
      ['logs', '--no-color', ...(o.tail ? ['--tail', String(o.tail)] : []), service],
      { allowFail: true, timeoutMs: 60_000 },
    )
    return res.stdout + res.stderr
  }
  const saveLogs = async () => {
    const out = join(ARTIFACTS_DIR, project)
    mkdirSync(out, { recursive: true })
    for (const service of ['circi', 'postgres', 'mailpit', ...(withS3 ? ['localstack'] : [])]) {
      writeFileSync(join(out, `${service}.log`), await logs(service as Stack.Service))
    }
    return out
  }
  const stop = async () => {
    if (stopped) return
    stopped = true
    bucket?.destroy()
    if (keep()) {
      // stderr, not console.log: vitest swallows console output from passing hooks.
      process.stderr.write(
        `\n[e2e] E2E_KEEP: left ${project} running at ${url} (mail: http://127.0.0.1:${mail})\n` +
          `[e2e] remove it with: docker compose -p ${project} down -v\n`,
      )
      return
    }
    const began = Date.now()
    await compose(['down', '-v', '--remove-orphans', '-t', '2'], { allowFail: true })
    await rm(dir, { recursive: true, force: true })
    phases.teardown = Date.now() - began
    if (!options.pooled) reportPhases(project, phases, options.label, options.profile)
  }

  const upBegan = Date.now()
  const wait = ['up', '-d', '--wait', '--wait-timeout', '240']
  try {
    // Everything that needs no address of its own in circi's environment first. `edge` is the
    // published face of circi: Docker assigns its port here, and circi starts after it knows it.
    await compose(
      [...wait, 'postgres', 'mailpit', 'edge', ...(withS3 ? ['localstack', 'edge-s3'] : [])],
      {
        timeoutMs: 300_000,
      },
    )
    ;[http, mail, s3Port] = await Promise.all([
      publishedPort('edge', 3000),
      publishedPort('mailpit', 8025),
      withS3 ? publishedPort('edge-s3', 4566) : Promise.resolve(undefined),
    ])
    // Sites need a dashboard host unrelated to the sites domain (`localhost` is a parent of
    // `*.localhost`), so then the dashboard is addressed by IP.
    url = `http://${options.sitesHost ? '127.0.0.1' : 'localhost'}:${http}`
    composeEnv['E2E_PUBLIC_URL'] = url
    mailbox = new Mailbox(`http://127.0.0.1:${mail}`)
    bucket = s3Port ? new S3Bucket(s3Port) : undefined
    Object.assign(environment, {
      ...(storage === 's3' && s3Port
        ? {
            STORAGE_DRIVER: 's3',
            S3_BUCKET,
            S3_REGION: 'us-east-1',
            // The host name containers and the host-run CLI both reach LocalStack under: presigned
            // upload URLs carry it. (The CLI maps it to loopback, see dns-preload.ts.)
            S3_ENDPOINT: `http://host.docker.internal:${s3Port}`,
            S3_FORCE_PATH_STYLE: 'true',
            S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
            S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
          }
        : {}),
      ...(options.sitesHost ? { STATIC_SITES_HOST: options.sitesHost } : {}),
      ...options.env,
    })
    writeOverride()
    await bucket?.ensure()
    await compose([...wait, 'circi'], { timeoutMs: 300_000 })
    phases.up = Date.now() - upBegan
    const healthyBegan = Date.now()
    await waitHealthy(url)
    phases.healthy = Date.now() - healthyBegan
  } catch (err) {
    await saveLogs().catch(() => undefined)
    await stop()
    throw new Error(
      `The stack ${project} did not come up: ${err instanceof Error ? err.message : String(err)}\n` +
        `Logs were saved under e2e/.artifacts/${project}/`,
      { cause: err },
    )
  }
  if (!mailbox) throw new Error('unreachable: the stack came up without a mailbox')

  const exec: Stack['exec'] = (service, command, o = {}) =>
    compose(['exec', '-T', service, ...command], {
      ...(o.allowFail !== undefined ? { allowFail: o.allowFail } : {}),
      timeoutMs: o.timeoutMs ?? 120_000,
    })

  return {
    url,
    composeProject: project,
    ports: { http, mail, s3: s3Port },
    storage,
    sitesHost: options.sitesHost,
    mail: mailbox,
    s3: bucket,
    hostFromContainers: 'http://host.docker.internal',
    exec,
    cli: async (...args) => (await exec('circi', ['circi', 'admin', ...args])).stdout.trim(),
    setupCode: async () => (await exec('circi', ['circi', 'admin', 'setup-code'])).stdout.trim(),
    sql: async (query) => {
      const res = await exec('postgres', [
        'psql',
        '-U',
        'circi',
        '-d',
        'circi',
        '-At',
        '-F',
        '\t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        query,
      ])
      return res.stdout
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => l.split('\t'))
    },
    jobs: {
      runNow: async (queue, filter = {}) => {
        const where = Object.entries(filter)
          .map(([key, value]) => ` and payload->>${sqlText(key)} = ${sqlText(value)}`)
          .join('')
        const rows = await exec('postgres', [
          'psql',
          '-U',
          'circi',
          '-d',
          'circi',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `with moved as (update jobs set run_at = now() where queue = ${sqlText(queue)} and status = 'pending'${where} returning 1) select count(*) from moved`,
        ])
        return Number(rows.stdout.trim())
      },
    },
    phases,
    logs,
    saveLogs,
    reconfigure: async (env) => {
      Object.assign(environment, env)
      writeOverride()
      await compose(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '240', 'circi'], {
        timeoutMs: 300_000,
      })
      await waitHealthy(url)
    },
    restart: async (service) => {
      await compose(['restart', service])
      if (service === 'circi') await waitHealthy(url)
    },
    stop,
  }
}

async function waitHealthy(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3_000) })
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`${url}/healthz not healthy after ${timeoutMs} ms (${last})`)
}

/** For tests that start stacks by hand: removes every stack of this run. */
export function removeAllStacks(): string[] {
  return removeRunProjectsSync(runId())
}
