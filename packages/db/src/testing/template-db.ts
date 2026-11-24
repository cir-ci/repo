import type { TestProject } from 'vitest/node'

import { prepareTestServer } from './server.ts'

/**
 * Vitest global setup for the packages whose tests create databases: finds or starts the test
 * Postgres server, makes sure this checkout's migrated template is on it (see server.ts), and
 * provides both, so each `createTestDb()` only clones the template. Also pins the time zone for the
 * worker processes.
 */
export default async function setup(project: TestProject): Promise<void> {
  process.env['TZ'] = 'UTC'
  project.provide('testServer', await prepareTestServer())
}
