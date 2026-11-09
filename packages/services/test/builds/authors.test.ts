import { listBuildsForTeam } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb, seedAccount, seedTeam } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recordPullRequestAuthor, startBuild } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const sha = (n: number) => `abc${String(n).padStart(6, '0')}`

describe('build author', () => {
  it('matches the author to the member who linked that provider account', async () => {
    const { team, owner } = await seedTeam(t.db)
    await seedAccount(t.db, { userId: owner.id, accountId: '583231' })
    const build = await startBuild(t.db, {
      teamId: team.id,
      commitSha: sha(1),
      author: { login: 'octocat', provider: 'github', providerId: '583231' },
    })
    expect(build).toMatchObject({ authorLogin: 'octocat', authorUserId: owner.id })
    const [item] = await listBuildsForTeam(t.db, team.id, { limit: 1 })
    expect(item?.author).toMatchObject({ login: 'octocat', name: expect.any(String) })
  })

  it('keeps the login but no user when nobody linked that account', async () => {
    const { team } = await seedTeam(t.db)
    const build = await startBuild(t.db, {
      teamId: team.id,
      commitSha: sha(2),
      author: { login: 'stranger', provider: 'github', providerId: '999' },
    })
    expect(build).toMatchObject({ authorLogin: 'stranger', authorUserId: null })
    const [item] = await listBuildsForTeam(t.db, team.id, { limit: 1 })
    expect(item?.author).toEqual({ login: 'stranger', name: null, avatarUrl: null })
  })

  it('leaves the user empty when the account matches two members', async () => {
    const { team, owner, workspace } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    await seedAccount(t.db, { userId: owner.id, accountId: '777' })
    // Another member of the same workspace linked the same GitHub id: ambiguous.
    await t.db.insert(schema.member).values({
      id: 'member-dup',
      workspaceId: workspace.id,
      userId: other.owner.id,
      role: 'member',
      createdAt: new Date(),
    })
    await seedAccount(t.db, { userId: other.owner.id, accountId: '777' })
    const build = await startBuild(t.db, {
      teamId: team.id,
      commitSha: sha(3),
      author: { login: 'twin', providerId: '777' },
    })
    expect(build.authorUserId).toBeNull()
  })

  it('has no author when none is sent', async () => {
    const { team } = await seedTeam(t.db)
    const build = await startBuild(t.db, { teamId: team.id, commitSha: sha(4) })
    expect(build).toMatchObject({ authorLogin: null, authorEmail: null, authorUserId: null })
    const [item] = await listBuildsForTeam(t.db, team.id, { limit: 1 })
    expect(item?.author).toBeNull()
  })

  it("a pull request's author replaces the CI's on every build of that pull request", async () => {
    const { team, owner } = await seedTeam(t.db)
    await seedAccount(t.db, { userId: owner.id, accountId: '42' })
    await startBuild(t.db, {
      teamId: team.id,
      commitSha: sha(5),
      prNumber: 7,
      author: { login: 'bot-pusher', email: 'bot@ci.test' },
    })
    await startBuild(t.db, { teamId: team.id, commitSha: sha(6), prNumber: 8 })
    const changed = await recordPullRequestAuthor(t.db, {
      teamId: team.id,
      prNumber: 7,
      login: 'alice',
      providerId: '42',
    })
    expect(changed).toBe(1)
    const rows = await t.db.select().from(schema.builds).where(eq(schema.builds.teamId, team.id))
    const pr7 = rows.find((r) => r.prNumber === 7)
    expect(pr7).toMatchObject({
      authorLogin: 'alice',
      authorEmail: null,
      authorUserId: owner.id,
    })
    expect(rows.find((r) => r.prNumber === 8)?.authorLogin).toBeNull()
  })
})
