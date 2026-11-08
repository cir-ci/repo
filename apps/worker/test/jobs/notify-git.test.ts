import {
  claimJob,
  completeJob,
  createBuild,
  GIT_NOTIFY_QUEUE,
  getCheckRunId,
  getPrCommentId,
  type Job,
  linkProjectToGithub,
  schema,
} from '@circi/db'
import { completeBuild, reviewBuild } from '@circi/services'
import { createTestDb, seedProject, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { notifyGit } from '../../src/jobs/notify-git.ts'

let t: TestDb
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
  const { project, owner } = await seedProject(t.db)
  await linkProjectToGithub(t.db, project.id, { installationId: '99', repoRef: 'acme/web' })
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'feature',
    ...(prNumber ? { prNumber } : {}),
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  return { project, owner, build: { ...build, status: 'processing' as const } }
}

describe('notifyGit', () => {
  it('reports a finished build as a check run and a pull request comment, then updates them', async () => {
    const { owner, build } = await linkedBuild(5)
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
    expect(await getPrCommentId(t.db, build.projectId, 5)).toBe('7001')

    // Approving queues another job, which updates the same check run and comment.
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await notifyGit(deps, await nextJob())).toEqual({ status: 'notified' })
    expect(fake.checks[1]?.input.existingId).toBe('9001')
    expect(fake.checks[1]?.input.report.conclusion).toBe('success')
    expect(fake.comments[1]?.existing).toBe('7001')
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

  it('queues nothing for a project that is not linked, and skips without a GitHub App', async () => {
    await t.db.delete(schema.jobs)
    const { project } = await seedProject(t.db)
    const build = await createBuild(t.db, { projectId: project.id, commitSha: 'def5678' })
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
})
