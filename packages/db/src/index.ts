// @circi/db: the persistence layer. Subpaths (`@circi/db/queries`, `/repositories`, `/queue`,
// `/schema`) show which layer a name comes from; this root re-exports all of them for now.

// ---- connection, errors, shared types
export {
  createDb,
  type Database,
  type DbHandle,
  type ListenFn,
  migrationsFolder,
  runMigrations,
  type Schema,
  withAdvisoryLock,
} from './client.ts'
export * from './errors.ts'
export type * from './types.ts'

// ---- queries: read models for the dashboard
export * from './queries/index.ts'

// ---- repositories: stores and lookups
export * from './repositories/index.ts'

// ---- queue: jobs, webhook deliveries, git notices (the outbox)
export * from './queue/index.ts'

// ---- schema: the Drizzle tables
export * as schema from './schema/index.ts'
