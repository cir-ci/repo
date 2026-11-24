import { fileURLToPath } from 'node:url'

import node from '@circi/vitest-config/vitest.node.config.ts'

// The tests create databases (`createTestDb()`): one migrated PGlite dump serves them all.
const templateDb = fileURLToPath(import.meta.resolve('@circi/db/testing/template-db'))

export default node(import.meta.dirname, { globalSetup: [templateDb] })
