import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'

import { authPlugins } from './plugins/index.ts'

/**
 * Only for `pnpm db:auth-schema`: the better-auth CLI reads this to generate
 * packages/db/src/schema/auth.ts. Same plugins as the server, no real database.
 */
export const auth = betterAuth({
  // The CLI only reads the plugins' table definitions and never queries, so any object will do.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion
  database: drizzleAdapter({} as never, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  plugins: authPlugins(),
})
