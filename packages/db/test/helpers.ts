import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import {
  createOrganization,
  createProject,
  type Database,
  migrationsFolder,
  schema,
} from '../src/index.ts'

export interface TestDb {
  client: PGlite
  db: Database
  close(): Promise<void>
}

/** A fresh in-process Postgres (PGlite) with every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder })
  return { client, db, close: () => client.close() }
}

let n = 0
/** Creates an org and a project with a unique slug; returns the project row and its token. */
export async function seedProject(db: Database, options: { defaultBranch?: string } = {}) {
  n += 1
  const slug = `org-${n}`
  await createOrganization(db, { name: `Org ${n}`, slug })
  return createProject(db, {
    orgSlug: slug,
    name: 'web',
    ...(options.defaultBranch ? { defaultBranch: options.defaultBranch } : {}),
  })
}

/** A fake sha256 made of one repeated hex digit. */
export const sha = (c: string) => c.repeat(64).slice(0, 64)
