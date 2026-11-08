/**
 * Test support shared by every package: an in-process Postgres (PGlite) with the real
 * migrations applied, and seeders that insert rows the way better-auth leaves them. Tests
 * import it as `@circi/testing` instead of reaching into another package's `test/` folder.
 */
export * from './db.ts'
export * from './seed/builds.ts'
export * from './seed/screenshots.ts'
export * from './seed/sites.ts'
export * from './seed/webhooks.ts'
export * from './seed/sessions.ts'
