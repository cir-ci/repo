#!/usr/bin/env node
import { ConfigError } from '@circi/config'
import { ValidationError } from '@circi/core'
import {
  ConflictError,
  createOrganization,
  createProject,
  listOrganizations,
  listProjects,
  NotFoundError,
  rotateProjectToken,
  runMigrations,
} from '@circi/db'
import { Command } from 'commander'

import { createRuntime, type Runtime } from './runtime.ts'
import { runServices } from './services.ts'

const program = new Command()
  .name('circi')
  .description('CirCI server: visual regression testing, self-hosted')
  .showHelpAfterError()

program
  .command('serve')
  .description('run the HTTP API and web UI')
  .option('--no-migrate', 'skip applying database migrations on start')
  .action((opts: { migrate: boolean }) =>
    runServices({ http: true, worker: false, migrate: opts.migrate }),
  )

program
  .command('worker')
  .description('run background jobs (diffing, notifications)')
  .option('--no-migrate', 'skip applying database migrations on start')
  .action((opts: { migrate: boolean }) =>
    runServices({ http: false, worker: true, migrate: opts.migrate }),
  )

program
  .command('all')
  .description('run the HTTP server and the worker in one process (small installs)')
  .option('--no-migrate', 'skip applying database migrations on start')
  .action((opts: { migrate: boolean }) =>
    runServices({ http: true, worker: true, migrate: opts.migrate }),
  )

program
  .command('migrate')
  .description('apply database migrations and exit')
  .action(() =>
    withRuntime(async (rt) => {
      await runMigrations(rt.db)
      console.log('Migrations applied.')
    }),
  )

const admin = program.command('admin').description('administration commands (run on the server)')

const org = admin.command('org').description('manage organizations')

org
  .command('create')
  .description('create an organization')
  .requiredOption('--name <name>', 'display name, e.g. "Acme Inc"')
  .option('--slug <slug>', 'URL name (default: derived from --name)')
  .option('--json', 'print JSON')
  .action((opts: { name: string; slug?: string; json?: boolean }) =>
    withRuntime(async (rt) => {
      const created = await createOrganization(rt.db.db, {
        name: opts.name,
        ...(opts.slug ? { slug: opts.slug } : {}),
      })
      if (opts.json) return printJson(created)
      console.log(`Created organization "${created.name}" (${created.slug})`)
    }),
  )

org
  .command('list')
  .description('list organizations')
  .option('--json', 'print JSON')
  .action((opts: { json?: boolean }) =>
    withRuntime(async (rt) => {
      const orgs = await listOrganizations(rt.db.db)
      if (opts.json) return printJson(orgs)
      if (orgs.length === 0) return console.log('No organizations yet.')
      for (const o of orgs) console.log(`${o.slug}\t${o.name}`)
    }),
  )

const project = admin.command('project').description('manage projects and their CI tokens')

project
  .command('create')
  .description('create a project and print its CI token')
  .requiredOption('--org <slug>', 'organization slug')
  .requiredOption('--name <name>', 'display name, e.g. "Web app"')
  .option('--slug <slug>', 'URL name (default: derived from --name)')
  .option('--default-branch <branch>', 'branch whose builds become baselines', 'main')
  .option('--json', 'print JSON (includes the token)')
  .action(
    (opts: { org: string; name: string; slug?: string; defaultBranch: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const { project: p, token } = await createProject(rt.db.db, {
          orgSlug: opts.org,
          name: opts.name,
          defaultBranch: opts.defaultBranch,
          ...(opts.slug ? { slug: opts.slug } : {}),
        })
        if (opts.json) return printJson({ project: publicProject(p), token })
        console.log(`Created project ${opts.org}/${p.slug} (default branch: ${p.defaultBranch})`)
        printToken(token)
      }),
  )

project
  .command('list')
  .description("list an organization's projects")
  .requiredOption('--org <slug>', 'organization slug')
  .option('--json', 'print JSON')
  .action((opts: { org: string; json?: boolean }) =>
    withRuntime(async (rt) => {
      const projects = await listProjects(rt.db.db, opts.org)
      if (opts.json) return printJson(projects.map(publicProject))
      if (projects.length === 0) return console.log(`No projects in ${opts.org} yet.`)
      for (const p of projects) {
        console.log(`${p.slug}\t${p.name}\tbranch=${p.defaultBranch}\ttoken=${p.tokenHint}`)
      }
    }),
  )

project
  .command('rotate-token')
  .description('replace a project CI token (the old one stops working immediately)')
  .requiredOption('--org <slug>', 'organization slug')
  .requiredOption('--project <slug>', 'project slug')
  .option('--json', 'print JSON (includes the token)')
  .action((opts: { org: string; project: string; json?: boolean }) =>
    withRuntime(async (rt) => {
      const { project: p, token } = await rotateProjectToken(rt.db.db, {
        orgSlug: opts.org,
        projectSlug: opts.project,
      })
      if (opts.json) return printJson({ project: publicProject(p), token })
      console.log(`Rotated the CI token for ${opts.org}/${p.slug}. The old token no longer works.`)
      printToken(token)
    }),
  )

/** Never print the token hash, even in JSON output. */
function publicProject<T extends { tokenHash: string }>(p: T): Omit<T, 'tokenHash'> {
  const { tokenHash: _hash, ...rest } = p
  return rest
}

function printToken(token: string): void {
  console.log('\nCI token (shown once, store it as the CIRCI_TOKEN secret in your CI):')
  console.log(`  ${token}`)
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function withRuntime(fn: (rt: Runtime) => Promise<void>): Promise<void> {
  const rt = createRuntime({ LOG_LEVEL: 'warn', ...process.env })
  try {
    await fn(rt)
  } finally {
    await rt.close()
  }
}

program.parseAsync(process.argv).catch((err: unknown) => {
  if (
    err instanceof ConfigError ||
    err instanceof ConflictError ||
    err instanceof NotFoundError ||
    err instanceof ValidationError
  ) {
    console.error(`error: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
})
