import { rm } from 'node:fs/promises'

import { DEFAULT_DIR } from '@circi/vitest'

/** Global setup of the `ui-visual` project: a run uploads only its own screenshots. */
export default async function setup(): Promise<void> {
  await rm(DEFAULT_DIR, { recursive: true, force: true })
}
