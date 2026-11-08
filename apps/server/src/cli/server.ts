import { runMigrations } from '@circi/db'
import type { Command } from 'commander'

import { runServices } from '#lifecycle/services.ts'

import { withRuntime } from './output.ts'

/** Long-running processes (`serve`, `worker`, `all`) and `migrate`. */
export function addServerCommands(program: Command): void {
  const services = [
    ['serve', 'run the HTTP API and web UI', { http: true, worker: false }],
    ['worker', 'run background jobs (diffing, notifications)', { http: false, worker: true }],
    [
      'all',
      'run the HTTP server and the worker in one process (small installs)',
      { http: true, worker: true },
    ],
  ] as const
  for (const [name, description, parts] of services) {
    program
      .command(name)
      .description(description)
      .option('--no-migrate', 'skip applying database migrations on start')
      .action((opts: { migrate: boolean }) => runServices({ ...parts, migrate: opts.migrate }))
  }

  program
    .command('migrate')
    .description('apply database migrations and exit')
    .action(() =>
      withRuntime(async (rt) => {
        await runMigrations(rt.db)
        console.log('Migrations applied.')
      }),
    )
}
