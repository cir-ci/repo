import { resolve } from 'node:path'

import node from '@circi/vitest-config/vitest.node.config.ts'

// The tests create databases (`createTestDb()`): one migrated PGlite dump serves them all.
export default node(import.meta.dirname, {
  globalSetup: [resolve(import.meta.dirname, 'src/testing/template-db.ts')],
})
