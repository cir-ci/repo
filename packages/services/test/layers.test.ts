import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositories = join(import.meta.dirname, '../../db/src/repositories')

/** The files that write to the job queue on behalf of others: the outbox itself. */
const OUTBOX = new Set(['jobs.ts', 'webhooks.ts', 'git.ts'])

describe('layers', () => {
  it('keeps repositories to storing data: only services queue jobs and notices', () => {
    const offenders = readdirSync(repositories)
      .filter((f) => f.endsWith('.ts') && !OUTBOX.has(f))
      .filter((f) =>
        /from '\.\/(jobs|webhooks|git)\.ts'/.test(readFileSync(join(repositories, f), 'utf8')),
      )
    // A repository that needs to trigger something must return what happened and let a
    // function in @circi/services do the triggering, inside its own transaction.
    expect(offenders).toEqual([])
  })
})
