import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { TestProject } from 'vitest/node'

import * as schema from '#schema/index.ts'
import { migrationsFolder } from '#src/index.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    templateDump: string
  }
}

/**
 * Vitest global setup for the node project: migrates one PGlite database, dumps it to a file
 * and provides its path, so each `createTestDb()` restores the dump instead of replaying every
 * migration. Also pins the time zone for the worker processes.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  process.env['TZ'] = 'UTC'
  const dir = await mkdtemp(join(tmpdir(), 'circi-template-db-'))
  const client = new PGlite()
  await migrate(drizzle({ client, schema }), { migrationsFolder })
  const dump = await client.dumpDataDir('none')
  await client.close()
  const path = join(dir, 'template.tar')
  await writeFile(path, Buffer.from(await dump.arrayBuffer()))
  project.provide('templateDump', path)
  return () => rm(dir, { recursive: true, force: true })
}
