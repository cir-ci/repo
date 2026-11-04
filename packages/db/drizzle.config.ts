import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` diffs src/schema/ against migrations/ and writes a new SQL migration.
// It needs no database connection. Migrations are applied at runtime by `circi migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
})
