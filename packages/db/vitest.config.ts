import { resolve } from 'node:path'

import node from '@circi/vitest-config/vitest.node.config.ts'

// The tests create databases (`createTestDb()`): each a copy of one migrated template on the test Postgres server.
export default node(import.meta.dirname, {
  globalSetup: [resolve(import.meta.dirname, 'src/testing/template-db.ts')],
})
