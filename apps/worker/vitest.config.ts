import { fileURLToPath } from 'node:url'

import node from '@circi/vitest-config/vitest.node.config.ts'

// The tests create databases (`createTestDb()`): each a copy of one migrated template on the test Postgres server.
const templateDb = fileURLToPath(import.meta.resolve('@circi/db/testing/template-db'))

export default node(import.meta.dirname, { globalSetup: [templateDb] })
