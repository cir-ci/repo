import { type Job } from '@circi/db'
import { getTeamGitAttention } from '@circi/db/queries'
import {
  claimJob,
  completeJob,
  GIT_NOTIFY_QUEUE,
  getCheckRunId,
  getPrCommentId,
} from '@circi/db/queue'
import { createBuild, setWorkspaceSettings, updateTeamSettings } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  createTestDb,
  seedBuild,
  imageSha,
  seedDiff,
  seedFlipFlops,
  seedGitLink,
  seedTeam,
  seedChangedSnapshots,
} from '@circi/db/testing'
import { GithubApiError, GithubInstallationRevokedError } from '@circi/integrations/github'
import { completeBuild, publishSite, reviewBuild, reviewSnapshots } from '@circi/services'
import { recordingGithub } from '@circi/testing/hosts'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { notifyGit } from '#jobs/notify-git.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

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

const sitesDeps = {
  originFor: (label: string) => `https://${label}.sites.test`,
  kindLabel: (kind: string) => (kind === 'storybook' ? 'Storybook' : kind),
}

/** A PR build with two changed snapshots, complete, its notify job queued and waiting. */
async function reviewableBuild(prNumber: number, commitSha = 'abc1234') {
  await t.db.delete(schema.jobs)
  const { team, owner } = await seedTeam(t.db)
  await seedGitLink(t.db, team.id, { externalId: '99', repoRef: 'acme/web' })
  const created = await createBuild(t.db, {
    teamId: team.id,
    commitSha,
    branch: 'feature',
    prNumber,
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, created.id))
  await seedChangedSnapshots(t.db, created.id, ['home', 'pricing'])
  await completeBuild(
    t.db,
    { ...created, status: 'processing' },
    {
      conclusion: 'changes_detected',
      approval: 'none',
    },
  )
  return { team, owner, build: created }
}

/** Queues a notice by hand, for a second look at the comment after the state changed. */
async function queueNotice(buildId: string) {
  await t.db.insert(schema.jobs).values({
    queue: GIT_NOTIFY_QUEUE,
    payload: { buildId },
    dedupeKey: `manual-${Math.random()}`,
  })
}

async function runNext(deps: Omit<notifyGit.Deps, 'db' | 'publicOrigin'> & object) {
  const job = await nextJob()
  const result = await notifyGit({ db: t.db, publicOrigin, ...deps }, job)
  await completeJob(t.db, job.id)
  return result
}

describe('the pull request comment', () => {
  it('lists the sites uploaded for the head commit, and is rewritten when one is uploaded later', async () => {
    const { team, build } = await reviewableBuild(5, 'abcdef012345')
    await t.db
      .update(schema.teams)
      .set({ staticHostingEnabled: true })
      .where(eq(schema.teams.id, team.id))
    const fake = recordingGithub()
    const deps = { github: fake.github, sites: sitesDeps }

    await runNext(deps)
    expect(fake.comments[0]?.body).not.toContain('Hosted sites')

    await publishSite(t.db, {
      teamId: team.id,
      name: 'ui-sb',
      kind: 'storybook',
      spa: false,
      commitSha: 'abcdef012345',
      entryPath: 'index.html',
      files: [{ path: 'index.html', sha256: 'a'.repeat(64), size: 3, contentType: 'text/html' }],
      storageKeys: new Map([['a'.repeat(64), 'k/a']]),
      fallbackKey: (sha) => `k/${sha}`,
      slugPrefix: 'web',
      addressing: {
        chooseSlug: () => 'web-storybook',
        commitLabel: (slug) => `abcdef012345-${slug}`,
        branchLabel: (_branch, slug) => `feat-${slug}`,
      },
    })
    // The upload queued the same notice as a build change: no new job kind.
    const queued = await t.db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.queue, GIT_NOTIFY_QUEUE), eq(schema.jobs.status, 'pending')))
    expect(queued.map((j) => j.payload)).toEqual([{ buildId: build.id }])

    await runNext(deps)
    expect(fake.comments).toHaveLength(2)
    expect(fake.comments[1]?.existing).toBe('7001')
    expect(fake.comments[1]?.body).toContain(
      '- [ui-sb](https://abcdef012345-web-storybook.sites.test) · Storybook',
    )
  })

  it('leaves the section out when the team has hosting off, the instance has none, or the commit has no site', async () => {
    const { team, build } = await reviewableBuild(6, 'abcdef012346')
    const fake = recordingGithub()
    const upload = (commitSha: string) =>
      publishSite(t.db, {
        teamId: team.id,
        name: 'docs',
        kind: 'generic',
        spa: false,
        commitSha,
        entryPath: 'index.html',
        files: [{ path: 'index.html', sha256: 'b'.repeat(64), size: 3, contentType: 'text/html' }],
        storageKeys: new Map([['b'.repeat(64), 'k/b']]),
        fallbackKey: (sha) => `k/${sha}`,
        slugPrefix: 'web',
        addressing: {
          chooseSlug: () => 'web-docs',
          commitLabel: (slug) => `${commitSha.slice(0, 12)}-${slug}`,
          branchLabel: (_branch, slug) => `feat-${slug}`,
        },
      })
    await upload('abcdef012346')
    await t.db.delete(schema.jobs)
    await queueNotice(build.id)
    await t.db
      .update(schema.teams)
      .set({ staticHostingEnabled: false })
      .where(eq(schema.teams.id, team.id))
    await runNext({ github: fake.github, sites: sitesDeps })
    expect(fake.comments.at(-1)?.body).not.toContain('Hosted sites') // hosting off for the team

    await t.db
      .update(schema.teams)
      .set({ staticHostingEnabled: true })
      .where(eq(schema.teams.id, team.id))
    await queueNotice(build.id)
    await runNext({ github: fake.github }) // the job runs with no sites configured
    expect(fake.comments.at(-1)?.body).not.toContain('Hosted sites')

    await queueNotice(build.id)
    await runNext({ github: fake.github, sites: sitesDeps })
    expect(fake.comments.at(-1)?.body).toContain('Hosted sites') // switched on and configured: listed
    await upload('f'.repeat(40)) // a different commit's upload is not listed for this commit
    await t.db.delete(schema.staticSites).where(eq(schema.staticSites.commitSha, 'abcdef012346'))
    await queueNotice(build.id)
    await runNext({ github: fake.github, sites: sitesDeps })
    expect(fake.comments.at(-1)?.body).not.toContain('Hosted sites')
  })

  it('shows the review status, who decided, and the per-snapshot counts, refreshed on every change', async () => {
    const { owner, build } = await reviewableBuild(7)
    const fake = recordingGithub()
    const deps = { github: fake.github }
    await runNext(deps)
    expect(fake.comments.at(-1)?.body).toContain('[Review](')

    // One of two snapshots approved: the build is still pending, and the comment says how far.
    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: ['home'],
    })
    await runNext(deps)
    expect(fake.comments.at(-1)?.body).toContain('(1 approved · 1 pending)')

    // Both approved: the build is approved, by name.
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    await runNext(deps)
    expect(fake.comments.at(-1)?.body).toContain(`✅ Approved by ${owner.name}`)

    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    await runNext(deps)
    expect(fake.comments.at(-1)?.body).toContain(`❌ Rejected by ${owner.name}`)
  })
})

describe('notifyGit', () => {
  it('reports a finished build as a check run and a pull request comment, then updates them', async () => {
    const { owner, build } = await linkedBuild(5)
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    const fake = recordingGithub()
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
    // `wobble` keeps returning to an image it had on main: A, B, A, B, A.
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B', 'A'])
    const pr = await seedBuild(t.db, team.id, {
      branch: 'feature',
      prNumber: 4,
      status: 'complete',
      conclusion: 'changes_detected',
    })
    await seedDiff(t.db, {
      buildId: pr.id,
      name: 'wobble',
      status: 'changed',
      headSha256: imageSha('B'),
      score: 0.02,
    })
    await seedDiff(t.db, { buildId: pr.id, name: 'steady', status: 'unchanged' })

    const fake = recordingGithub()
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

    // A GitHub that holds every answer until `release` is called, with no memory of its own
    // beyond what it was sent. If the lanes were not serialized, both would reach it and wait here.
    const checks: string[] = []
    const comments: string[] = []
    let reached = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const github = {
      async upsertCheckRun(_i: string, _r: string, input: { existingId?: string }) {
        reached += 1
        await gate
        if (input.existingId) return input.existingId
        checks.push('created')
        return `check-${checks.length}`
      },
      async upsertComment(_i: string, _r: string, _pr: number, _body: string, existing?: string) {
        await gate
        if (existing) return existing
        comments.push('created')
        return `comment-${comments.length}`
      },
    }
    const deps = { db: t.db, github, publicOrigin: 'https://ci.acme.io' }
    const both = Promise.all([notifyGit(deps, first), notifyGit(deps, second)])
    // Give a second, unserialized lane the chance to arrive at GitHub: it would, at once.
    await vi
      .waitFor(
        () => {
          if (reached < 2) throw new Error('only one lane reached GitHub')
        },
        { timeout: 250 },
      )
      .catch(() => undefined)
    release()
    await both

    expect(checks).toEqual(['created'])
    expect(comments).toEqual(['created'])
  })

  it('skips the comment for builds with no pull request', async () => {
    const { build } = await linkedBuild(null)
    await completeBuild(t.db, build, { conclusion: 'no_changes', approval: 'none' })
    const fake = recordingGithub()
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
      const fake = recordingGithub()
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
