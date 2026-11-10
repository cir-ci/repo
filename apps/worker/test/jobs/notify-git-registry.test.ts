import { sealSecret } from '@circi/core/node'
import { claimJob, GIT_NOTIFY_QUEUE } from '@circi/db/queue'
import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb, seedGitLink, seedTeam } from '@circi/db/testing'
import { providerRegistry } from '@circi/integrations/git'
import { GithubApiError } from '@circi/integrations/github'
import { completeBuild } from '@circi/services'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { notifyGit } from '#jobs/notify-git.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function queuedJob(sealed?: string) {
  const { team } = await seedTeam(t.db)
  await seedGitLink(t.db, team.id, { externalId: '5', repoRef: 'acme/web' })
  if (sealed) {
    await t.db.update(schema.integrations).set({ encryptedCredentials: sealed })
  }
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'x',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  await completeBuild(
    t.db,
    { ...build, status: 'processing' },
    { conclusion: 'no_changes', approval: 'none' },
  )
  const job = await claimJob(t.db, GIT_NOTIFY_QUEUE, 60)
  if (!job) throw new Error('no job')
  return job
}

describe('notifyGit resolves the provider by the connection kind', () => {
  it('calls the registry’s provider for the connection’s kind', async () => {
    const calls: string[] = []
    const github = {
      upsertCheckRun: async (id: string) => {
        calls.push(`check ${id}`)
        return '1'
      },
      upsertComment: async () => '2',
    }
    const result = await notifyGit(
      { db: t.db, providers: providerRegistry({ github }), publicOrigin: 'https://ci' },
      await queuedJob(),
    )
    expect(result).toEqual({ status: 'notified' })
    expect(calls).toEqual(['check 5'])
  })

  it('skips, without failing, when no adapter serves the kind', async () => {
    const job = await queuedJob()
    const other = {
      upsertCheckRun: async (): Promise<string> => {
        throw new GithubApiError(500, 'must not be called')
      },
      upsertComment: async (): Promise<string> => '2',
    }
    const result = await notifyGit(
      { db: t.db, providers: providerRegistry({ gitlab: other }), publicOrigin: 'https://ci' },
      job,
    )
    expect(result).toEqual({ status: 'skipped', reason: 'no github provider configured' })
  })

  it('opens the connection’s sealed credentials for the provider, and never for GitHub’s own', async () => {
    const seen: (string | undefined)[] = []
    const github = {
      upsertCheckRun: async (_id: string, _repo: string, _input: unknown, credentials?: string) => {
        seen.push(credentials)
        return '1'
      },
      upsertComment: async () => '2',
    }
    const deps = { db: t.db, providers: providerRegistry({ github }), publicOrigin: 'https://ci' }
    await notifyGit({ ...deps, authSecret: 's3cret' }, await queuedJob())
    await notifyGit(
      { ...deps, authSecret: 's3cret' },
      await queuedJob(sealSecret('s3cret', 'token-1')),
    )
    expect(seen).toEqual([undefined, 'token-1'])
    const unreadable = await notifyGit(
      { ...deps, authSecret: 'other' },
      await queuedJob(sealSecret('s3cret', 'token-1')),
    )
    expect(unreadable).toEqual({ status: 'skipped', reason: "github credentials can't be opened" })
  })
})
