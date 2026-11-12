import type { Database } from '@circi/db'
import { linkBuildsToPullRequest } from '@circi/db/queue'
import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedAccount,
  seedChangedSnapshots,
  seedGitLink,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import type { IntegrationDefinition } from '@circi/integrations'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleGitEvents } from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const noop = () => undefined

/** What the fake host was told: the edge is faked, the handler's decisions are real. */
function recorder() {
  const answers: IntegrationDefinition.GitAnswer[] = []
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fake of a large interface
  const definition = {
    id: 'github',
    name: 'GitHub',
    capabilities: {
      git: {
        respond: async (said: IntegrationDefinition.GitAnswer) => {
          answers.push(said)
        },
      },
    },
  } as unknown as IntegrationDefinition
  return { answers, definition }
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fake, see above
const ctx = {} as unknown as IntegrationDefinition.Context

let seq = 0

async function world(
  build: Partial<typeof schema.builds.$inferInsert>,
  diffs: { changed: string[]; failed: string[] },
) {
  seq += 1
  const repoRef = `acme/web-${seq}`
  const { project, workspace } = await seedProject(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: reviewer.id })
  await seedAccount(t.db, { userId: reviewer.id, accountId: `acc-${seq}` })
  await seedGitLink(t.db, project.id, { externalId: '1', repoRef })
  const created = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  await t.db.update(schema.builds).set(build).where(eq(schema.builds.id, created.id))
  await seedChangedSnapshots(t.db, created.id, diffs.changed)
  if (diffs.failed.length > 0) {
    await t.db.insert(schema.screenshotDiffs).values(
      diffs.failed.map((name) => ({
        buildId: created.id,
        name,
        status: 'failed' as const,
        jobStatus: 'done' as const,
      })),
    )
  }
  await linkBuildsToPullRequest(t.db, { projectId: project.id, prNumber: 7, commitSha: 'abc1234' })
  return { buildId: created.id, repoRef, accountId: `acc-${seq}` }
}

async function command(
  input: { definition: IntegrationDefinition },
  who: { repoRef: string; accountId: string },
  verb: 'approve' | 'reject',
  db = t.db,
) {
  await handleGitEvents(db, {
    definition: input.definition,
    ctx,
    log: { info: noop, warn: noop },
    events: [
      {
        type: 'command',
        command: verb,
        number: 7,
        repo: { ref: who.repoRef, connection: { externalId: '1' } },
        actor: { accountId: who.accountId, login: 'reviewer' },
      },
    ],
  })
}

const complete = { status: 'complete' as const, conclusion: 'changes_detected' as const }

describe('/circi approve and reject', () => {
  it('approves a build with readable changes', async () => {
    const { buildId, ...seeded } = await world(complete, { changed: ['home'], failed: [] })
    const fake = recorder()
    await command(fake, seeded, 'approve')
    expect(fake.answers.map((a) => a.outcome)).toEqual(['acted'])
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, buildId))
    expect(row?.reviewStatus).toBe('approved')
  })

  it('does not report success on a build whose only changes are unreadable', async () => {
    const { buildId, ...seeded } = await world(complete, { changed: [], failed: ['home'] })
    const fake = recorder()
    await command(fake, seeded, 'approve')
    expect(fake.answers).toMatchObject([{ outcome: 'ignored', reason: 'unreadable' }])
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, buildId))
    expect(row?.reviewStatus).toBe('pending')
  })

  it('says the build changed on a stale-state conflict, not that it failed', async () => {
    const { buildId, ...seeded } = await world(complete, { changed: ['home'], failed: [] })
    const fake = recorder()
    // The build leaves "complete" between the check and the decision: the transaction refuses.
    const racing = new Proxy(t.db, {
      get(target, prop) {
        if (prop === 'transaction') {
          return async (fn: (tx: Database) => Promise<unknown>) => {
            await t.db
              .update(schema.builds)
              .set({ status: 'processing' })
              .where(eq(schema.builds.id, buildId))
            return target.transaction(fn)
          }
        }
        const value: unknown = Reflect.get(target, prop, target)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a method of the real db
        return typeof value === 'function' ? (value.bind(target) as unknown) : value
      },
    })
    await command(fake, seeded, 'approve', racing)
    expect(fake.answers).toMatchObject([{ outcome: 'ignored', reason: 'conflict' }])
  })

  it('gives a generic reason for any other error', async () => {
    const { buildId: _unused, ...seeded } = await world(complete, { changed: ['home'], failed: [] })
    const fake = recorder()
    const broken = new Proxy(t.db, {
      get(target, prop) {
        if (prop === 'transaction') {
          return () => {
            throw new Error('connection reset')
          }
        }
        const value: unknown = Reflect.get(target, prop, target)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a method of the real db
        return typeof value === 'function' ? (value.bind(target) as unknown) : value
      },
    })
    await command(fake, seeded, 'reject', broken)
    expect(fake.answers).toMatchObject([{ outcome: 'ignored', reason: 'error' }])
  })
})
