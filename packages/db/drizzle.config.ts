import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` diffs src/schema.ts against migrations/ and writes a new SQL migration.
// It needs no database connection. Migrations are applied at runtime by `zopheros migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
})
