/**
 * `pnpm dev`: a local environment for QA. Postgres and Mailpit run in Docker (dev/compose.yml);
 * the server (`circi all`: API and worker) runs from source and restarts on changes; the
 * dashboard runs in Vite with hot reload. The first run seeds accounts and sample builds.
 *
 *   pnpm dev          start everything (Ctrl+C stops it; the database is kept)
 *   pnpm dev:reset    delete the database, files and seed, so the next `pnpm dev` starts fresh
 */
import type { ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  COMPOSE_FILE,
  PORTS,
  SEED,
  SERVER_MAIN,
  STATE_DIR,
  URLS,
  WEB_DIR,
  WEBHOOK_RECEIVER_MAIN,
  serverEnv,
} from './config.ts'
import { explainPortTaken, isPortTaken, log, run, start, waitForHttp } from './processes.ts'
import { ensureSeeded } from './seed.ts'

const children: ChildProcess[] = []

/** The ports `pnpm dev` binds itself (Postgres and Mailpit's are Docker's, and say so on their own). */
const OWN_PORTS = [
  { name: 'server', what: 'the server', port: PORTS.server, envVar: 'CIRCI_DEV_PORT' },
  { name: 'web', what: 'the dashboard (Vite)', port: PORTS.web, envVar: 'CIRCI_DEV_WEB_PORT' },
  {
    name: 'hooks',
    what: 'the webhook receiver',
    port: PORTS.hooks,
    envVar: 'CIRCI_DEV_HOOKS_PORT',
  },
] as const

async function reportPortTaken(entry: (typeof OWN_PORTS)[number]): Promise<boolean> {
  if (!(await isPortTaken(entry.port))) return false
  for (const line of await explainPortTaken(entry)) log('dev', line)
  return true
}

const compose = (args: string[], inherit = false) =>
  run('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    inherit,
    env: {
      CIRCI_DEV_POSTGRES_PORT: String(PORTS.postgres),
      CIRCI_DEV_SMTP_PORT: String(PORTS.smtp),
      CIRCI_DEV_MAIL_PORT: String(PORTS.mail),
    },
  })

async function reset(): Promise<void> {
  log('dev', 'Removing the dev containers, database and files')
  await compose(['down', '--volumes', '--remove-orphans'], true)
  await rm(STATE_DIR, { recursive: true, force: true })
  log('dev', 'Done: the next `pnpm dev` starts from an empty database')
}

async function up(): Promise<void> {
  try {
    await run('docker', ['info', '--format', '{{.ServerVersion}}'])
  } catch {
    throw new Error('Docker is not running: pnpm dev needs it for Postgres and Mailpit')
  }
  // Before anything starts: a taken port is the usual reason `pnpm dev` fails, and the child's own
  // error ("EADDRINUSE", "Port 5173 is in use") does not say who holds it.
  const taken = await Promise.all(OWN_PORTS.map((entry) => reportPortTaken(entry)))
  if (taken.includes(true)) process.exit(1)
  log('dev', 'Starting Postgres and Mailpit')
  await compose(['up', '--detach', '--wait'], true)
  await mkdir(join(STATE_DIR, 'files'), { recursive: true })

  let stopping = false
  const stop = (code: number) => {
    if (stopping) return
    stopping = true
    log('dev', 'Stopping (the database is kept; `pnpm dev:reset` deletes it)')
    for (const child of children) child.kill('SIGTERM')
    // Stopped, not removed: the volumes keep the data for the next run.
    void compose(['stop'])
      .catch(() => undefined)
      .finally(() => process.exit(code))
  }
  process.on('SIGINT', () => stop(0))
  process.on('SIGTERM', () => stop(0))
  const supervise = (name: string, child: ChildProcess) => {
    children.push(child)
    child.on('exit', (code) => {
      if (stopping) return
      log('dev', `${name} exited (${code ?? 'signal'}); stopping`)
      // It may have lost a race for its port after the check above: say who holds it.
      const entry = OWN_PORTS.find((e) => e.name === name)
      void (entry && code !== 0 ? reportPortTaken(entry) : Promise.resolve(false)).finally(() =>
        stop(1),
      )
    })
  }

  // --watch restarts the server when a source file it imports changes (the worker is in the same process).
  supervise(
    'server',
    start(
      'server',
      process.execPath,
      ['--watch', '--watch-preserve-output', '--conditions=@circi/source', SERVER_MAIN, 'all'],
      serverEnv(),
    ),
  )
  supervise(
    'web',
    start(
      'web',
      // Vite's own binary, not `pnpm exec`, which reports a failure when Vite is stopped.
      join(WEB_DIR, 'node_modules', '.bin', 'vite'),
      ['--port', String(PORTS.web), '--strictPort'],
      { CIRCI_DEV_API_URL: URLS.server },
      WEB_DIR,
    ),
  )

  // The seeded webhooks deliver here; it needs no database, so it starts with the rest.
  supervise(
    'hooks',
    start('hooks', process.execPath, ['--conditions=@circi/source', WEBHOOK_RECEIVER_MAIN]),
  )

  await waitForHttp(`${URLS.server}/readyz`, 120_000)
  const { token } = await ensureSeeded()
  await waitForHttp(URLS.web, 60_000)

  const { owner, member, password, workspace, project } = SEED
  const lines = [
    '',
    `Dashboard   ${URLS.web}/${workspace.slug}/${project.slug}`,
    `Sign in     ${owner.email} (owner, instance admin) or ${member.email} (member)`,
    `Password    ${password}`,
    `Mail        ${URLS.mail}  (sign-in codes, invitations)`,
    `Webhooks    ${URLS.hooks}  (seeded webhooks deliver here; each delivery is logged as [hooks])`,
    `API         ${URLS.server}`,
    `Database    postgres://circi:circi@localhost:${PORTS.postgres}/circi`,
    '',
    'Upload your own screenshots to the seeded project:',
    `  CIRCI_API_URL=${URLS.server} CIRCI_TOKEN=${token} node --conditions=@circi/source packages/cli/src/main.ts upload <dir> --wait`,
    '',
    'Ctrl+C stops everything; `pnpm dev:reset` starts over with fresh data.',
    '',
  ]
  for (const line of lines) log('dev', line)
}

const command = process.argv[2] ?? 'up'
try {
  if (command === 'reset') await reset()
  else if (command === 'up') await up()
  else throw new Error(`Unknown command "${command}" (use up or reset)`)
} catch (error) {
  log('dev', error instanceof Error ? error.message : String(error))
  for (const child of children) child.kill('SIGTERM')
  process.exit(1)
}
