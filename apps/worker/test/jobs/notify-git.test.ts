import {
  claimJob,
  completeJob,
  createBuild,
  GIT_NOTIFY_QUEUE,
  getCheckRunId,
  getTeamGitAttention,
  getPrCommentId,
  type Job,
  schema,
  setWorkspaceSettings,
  updateTeamSettings,
} from '@circi/db'
import { GithubApiError, GithubInstallationRevokedError } from '@circi/providers'
import { completeBuild, reviewBuild } from '@circi/services'
import {
  createTestDb,
  seedBuild,
  seedDiff,
  seedGitLink,
  seedTeam,
  seedChangedSnapshots,
} from '@circi/testing'
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

interface CheckCall {
  installationId: string
  repo: string
  input: {
    sha: string
    detailsUrl: string
    existingId?: string
    report: { conclusion?: string; actions: unknown[] }
  }
}
interface CommentCall {
  installationId: string
  repo: string
  pr: number
  body: string
  existing?: string
}

/** Records what would be sent to GitHub. */
function fakeGithub() {
  const checks: CheckCall[] = []
  const comments: CommentCall[] = []
  return {
    checks,
    comments,
    github: {
      async upsertCheckRun(installationId: string, repo: string, input: CheckCall['input']) {
        checks.push({ installationId, repo, input })
        return '9001'
      },
      async upsertComment(
        installationId: string,
        repo: string,
        pr: number,
        body: string,
        existing?: string,
      ) {
        comments.push({ installationId, repo, pr, body, ...(existing ? { existing } : {}) })
        return '7001'
      },
    },
  }
}

async function nextJob(): Promise<Job> {
  const job = await claimJob(t.db, GIT_NOTIFY_QUEUE, 60)
  if (!job) throw new Error('no git-notify job')
  return job
}

async function linkedBuild(prNumber: number | null) {
  await t.db.delete(schema.jobs)
  const { team, owner } = await seedTeam(t.db)
  await seedGitLink(t.db, team.id, { externalId: '99', repoRef: 'acme/web' })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
    ...(prNumber ? { prNumber } : {}),
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  return { team, owner, build: { ...build, status: 'processing' as const } }
}

const publicOrigin = 'https://ci.acme.io'
const revoked = () =>
  new GithubInstallationRevokedError('77', new GithubApiError(401, 'GitHub: Bad credentials'))

async function setup() {
  const linked = await linkedBuild(null)
  await seedGitLink(t.db, linked.team.id, { externalId: '77', repoRef: 'acme/web' })
  await completeBuild(t.db, linked.build, { conclusion: 'no_changes', approval: 'none' })
  return linked
}
const failing = (error: Error) => ({
  upsertCheckRun: async (): Promise<string> => {
    throw error
  },
  upsertComment: async (): Promise<string> => {
    throw error
  },
})

describe('notifyGit', () => {
  it('reports a finished build as a check run and a pull request comment, then updates them', async () => {
    const { owner, build } = await linkedBuild(5)
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    const fake = fakeGithub()
    const deps = { db: t.db, github: fake.github, publicOrigin: 'https://ci.acme.io' }

    const job = await nextJob()
    expect(await notifyGit(deps, job)).toEqual({ status: 'notified' })
    await completeJob(t.db, job.id)

    expect(fake.checks).toHaveLength(1)
    expect(fake.checks[0]).toMatchObject({ installationId: '99', repo: 'acme/web' })
    expect(fake.checks[0]?.input.sha).toBe('abc1234')
    expect(fake.checks[0]?.input.report.conclusion).toBe('action_required')
    expect(fake.checks[0]?.input.report.actions).toHaveLength(2)
    expect(fake.checks[0]?.input.detailsUrl).toMatch(/^https:\/\/ci\.acme\.io\/.+\/builds\/1$/)
    expect(await getCheckRunId(t.db, build.id)).toBe('9001')

    expect(fake.comments[0]?.pr).toBe(5)
    expect(fake.comments[0]?.body).toContain('CirCI visual tests')
    expect(await getPrCommentId(t.db, build.teamId, 5)).toBe('7001')

    // Approving queues another job, which updates the same check run and comment.
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await notifyGit(deps, await nextJob())).toEqual({ status: 'notified' })
    expect(fake.checks[1]?.input.existingId).toBe('9001')
    expect(fake.checks[1]?.input.report.conclusion).toBe('success')
    expect(fake.comments[1]?.existing).toBe('7001')
  })

  it('passes a flaky-only change when flaky screenshots do not block merges (workspace default, team override)', async () => {
    await t.db.delete(schema.jobs)
    const { team, workspace } = await seedTeam(t.db)
    await seedGitLink(t.db, team.id, { externalId: '99', repoRef: 'acme/web' })
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      const main = await seedBuild(t.db, team.id, { branch: 'main', status: 'complete' })
      // oxlint-disable-next-line no-await-in-loop
      await seedDiff(t.db, { buildId: main.id, name: 'wobble', status: 'changed' })
    }
    const pr = await seedBuild(t.db, team.id, {
      branch: 'feature',
      prNumber: 4,
      status: 'complete',
      conclusion: 'changes_detected',
    })
    await seedDiff(t.db, { buildId: pr.id, name: 'wobble', status: 'changed' })
    await seedDiff(t.db, { buildId: pr.id, name: 'steady', status: 'unchanged' })

    const fake = fakeGithub()
    const deps = { db: t.db, github: fake.github, publicOrigin: 'https://ci.acme.io' }
    const conclusion = async () => {
      await t.db.insert(schema.jobs).values({
        queue: GIT_NOTIFY_QUEUE,
        payload: { buildId: pr.id },
        dedupeKey: `flaky-${fake.checks.length}`,
      })
      await notifyGit(deps, await nextJob())
      return fake.checks.at(-1)?.input.report.conclusion
    }

    expect(await conclusion()).toBe('action_required') // the default: flaky changes block
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await conclusion()).toBe('success')
    expect(fake.checks.at(-1)?.input.report).toMatchObject({
      title: 'Only flaky screenshots changed (1 changed)',
    })
    await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: true })
    expect(await conclusion()).toBe('action_required') // the team overrides the workspace
  })

  it('serializes concurrent jobs, so one build gets one check run and one comment', async () => {
    const { build } = await linkedBuild(8)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    // A second notice for the same build, as when a build is reported while processing and again
    // when it completes: both are queued and may be claimed by two worker lanes at once.
    await t.db.insert(schema.jobs).values({
      queue: GIT_NOTIFY_QUEUE,
      payload: { buildId: build.id },
      dedupeKey: 'second-notice',
    })
    const first = await nextJob()
    const second = await nextJob()

    // A GitHub that is slow to answer, with no memory of its own beyond what it was sent.
    const checks: string[] = []
    const comments: string[] = []
    const github = {
      async upsertCheckRun(_i: string, _r: string, input: { existingId?: string }) {
        await new Promise((r) => setTimeout(r, 40))
        if (input.existingId) return input.existingId
        checks.push('created')
        return `check-${checks.length}`
      },
      async upsertComment(_i: string, _r: string, _pr: number, _body: string, existing?: string) {
        await new Promise((r) => setTimeout(r, 40))
        if (existing) return existing
        comments.push('created')
        return `comment-${comments.length}`
      },
    }
    const deps = { db: t.db, github, publicOrigin: 'https://ci.acme.io' }
    await Promise.all([notifyGit(deps, first), notifyGit(deps, second)])

    expect(checks).toEqual(['created'])
    expect(comments).toEqual(['created'])
  })

  it('skips the comment for builds with no pull request', async () => {
    const { build } = await linkedBuild(null)
    await completeBuild(t.db, build, { conclusion: 'no_changes', approval: 'none' })
    const fake = fakeGithub()
    await notifyGit(
      { db: t.db, github: fake.github, publicOrigin: 'https://ci.acme.io' },
      await nextJob(),
    )
    expect(fake.checks).toHaveLength(1)
    expect(fake.comments).toHaveLength(0)
  })

  it('queues nothing for a team that is not linked, and skips without a GitHub App', async () => {
    await t.db.delete(schema.jobs)
    const { team } = await seedTeam(t.db)
    const build = await createBuild(t.db, { teamId: team.id, commitSha: 'def5678' })
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, build.id))
    await completeBuild(
      t.db,
      { ...build, status: 'processing' },
      { conclusion: 'no_changes', approval: 'none' },
    )
    expect(await claimJob(t.db, GIT_NOTIFY_QUEUE, 60)).toBeUndefined()

    const linked = await linkedBuild(null)
    await completeBuild(t.db, linked.build, { conclusion: 'no_changes', approval: 'none' })
    const job = await nextJob()
    expect(
      await notifyGit({ db: t.db, github: undefined, publicOrigin: 'https://x' }, job),
    ).toMatchObject({
      status: 'skipped',
    })
  })

  describe('a revoked installation', () => {
    it('stops retrying, records that the team needs attention, and clears it when GitHub answers again', async () => {
      const { team, build } = await setup()
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toBeUndefined()

      const job = await nextJob()
      const result = await notifyGit({ db: t.db, github: failing(revoked()), publicOrigin }, job)
      // Returned, not thrown: the queue marks the job done instead of retrying five times.
      expect(result).toMatchObject({ status: 'skipped', reason: expect.stringContaining('77') })
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toMatchObject({
        reason: 'installation_revoked',
      })

      // Other errors still throw (and so retry), and do not touch the state.
      await expect(
        notifyGit(
          { db: t.db, github: failing(new GithubApiError(502, 'bad gateway')), publicOrigin },
          job,
        ),
      ).rejects.toThrow('bad gateway')
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toBeDefined()

      // The App was reinstalled: the next call works and the warning goes away.
      const fake = fakeGithub()
      expect(await notifyGit({ db: t.db, github: fake.github, publicOrigin }, job)).toEqual({
        status: 'notified',
      })
      expect(fake.checks).toHaveLength(1)
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toBeUndefined()
      expect(await getCheckRunId(t.db, build.id)).toBe('9001')
    })

    it('is cleared by linking the team to the installation again', async () => {
      const { team } = await setup()
      await notifyGit({ db: t.db, github: failing(revoked()), publicOrigin }, await nextJob())
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toBeDefined()
      await seedGitLink(t.db, team.id, { externalId: '77', repoRef: 'acme/web' })
      expect(await getTeamGitAttention(t.db, team.id, ['github'])).toBeUndefined()
    })
  })
})
