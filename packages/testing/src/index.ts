/**
 * Test support shared by every package: an in-process Postgres (PGlite) with the real
 * migrations applied, and seeders that insert rows the way better-auth leaves them. Tests
 * import it as `@circi/testing` instead of reaching into another package's `test/` folder.
 */
export * from './db.ts'
