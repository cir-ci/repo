// @circi/db: the persistence layer. The root is the connection, the errors and the shared types
// only; every other name comes from a subpath that shows its layer: `@circi/db/queries` (read
// models), `/repositories` (stores and lookups), `/queue` (jobs, webhook rows, git notices) and
// `/schema` (the Drizzle tables).

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
