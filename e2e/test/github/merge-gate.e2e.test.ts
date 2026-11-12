import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject } from '#clients/admin.ts'
import { uploadBuild, uploadOrThrow } from '#clients/upload.ts'
import type { FakeGithub } from '#fakes/fake-github.ts'
import { Repo } from '#github/git-repo.ts'
import {
  buildDetail,
  commentPayload,
  createGithubUser,
  createLinkedProject,
  type LinkedProject,
  uniqueInstallationId,
  uploadPr,
} from '#github/github-helpers.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * The merge gate: what the CirCI check says for each state of a build, with `Block merging until
 * approved` on and off, and what `circi upload --wait` exits with. GitHub is a fake on the host.
 */
describe('merge gate (against a fake GitHub)', () => {
  let gh: FakeGithub
  const ctx = useStack({ profile: 'github', setup: true })
  // The profile's fake GitHub, reset for this file. Registered right after useStack's own hooks.
  beforeAll(() => {
    gh = ctx.github
  })
  let blocking: LinkedProject
  let lenient: LinkedProject
  let workspace = ''

  // Registered after useStack's own hook, so the stack and the signed-in admin exist. Setting the
  // two projects up here (not in a test) lets every test run alone, in any order.
  beforeAll(async () => {
    const { stack, setup } = ctx
    workspace = setup.workspace.slug
    blocking = await createLinkedProject(stack, setup.session, workspace, 'Blocking', {
      repoRef: 'acme/blocking',
      blockMergeOnChanges: true,
    })
    lenient = await createLinkedProject(stack, setup.session, workspace, 'Lenient', {
      repoRef: 'acme/lenient',
      blockMergeOnChanges: false,
    })
  })

  const checkFor = (sha: string) => gh.checkRuns.find((c) => c.headSha === sha)
  const settle = async (sha: string) => {
    await expect.poll(() => checkFor(sha)?.status, { timeout: 30_000 }).toBe('completed')
  }

  it('the baseline on main is reported too: it waited for review, and is success once approved', async () => {
    // createLinkedProject approved it: a first build is never approved automatically.
    await expect
      .poll(() => checkFor(blocking.baselineSha)?.conclusion, { timeout: 30_000 })
      .toBe('success')
    expect(checkFor(blocking.baselineSha)?.title).toMatch(/^Changes approved/)
  })

  it('no changes: success, "No visual changes", no buttons', async () => {
    const pr = await uploadPr(ctx.stack, blocking, 30, {})
    expect(pr.exitCode).toBe(0)
    await settle(pr.sha)
    expect(checkFor(pr.sha)).toMatchObject({
      conclusion: 'success',
      title: 'No visual changes',
      actions: [],
    })
    expect(checkFor(pr.sha)?.summary).toContain('2 screenshots compared, none differ.')
  })

  it('changes pending review: action_required when blocking, success when not', async () => {
    const hard = await uploadPr(ctx.stack, blocking, 31, { login: { dot: { x: 200, y: 100 } } })
    const soft = await uploadPr(ctx.stack, lenient, 31, { login: { dot: { x: 200, y: 100 } } })
    await settle(hard.sha)
    await settle(soft.sha)
    expect(checkFor(hard.sha)).toMatchObject({
      conclusion: 'action_required',
      title: '1 changed: review required',
    })
    expect(checkFor(soft.sha)).toMatchObject({
      conclusion: 'success',
      title: '1 changed: review required',
    })
    // The buttons are offered either way.
    expect(checkFor(soft.sha)?.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
  })

  it('switching the setting changes what the next notification says', async () => {
    const { stack, setup } = ctx
    // Its own project: the setting is switched here, so no other test can see it (and a failure
    // half-way leaves nothing behind that another test would trip over).
    const own = await createLinkedProject(stack, setup.session, workspace, 'Switching', {
      repoRef: 'acme/switching',
      blockMergeOnChanges: false,
    })
    const pr = await uploadPr(stack, own, 32, { login: { dot: { x: 220, y: 100 } } })
    await settle(pr.sha)
    expect(checkFor(pr.sha)?.conclusion).toBe('success')
    await setup.session.patch(`/api/projects/${workspace}/${own.slug}/settings`, {
      blockMergeOnChanges: true,
    })
    // A re-run (`/circi rerun` from a linked member) re-notifies with the new rule. The build is
    // processed again first, then reported: two worker steps, so allow for a loaded machine.
    const member = await createGithubUser(stack, {
      githubUserId: '5001',
      workspace,
      projects: [own.slug],
    })
    expect(member.email).toBeTruthy()
    const comment = gh.seedComment('acme/switching', 32, '/circi rerun')
    const res = await gh.sendWebhook(
      stack.url,
      'issue_comment',
      commentPayload(
        'acme/switching',
        32,
        comment.id,
        '/circi rerun',
        { id: 5001, login: 'maya' },
        own.installationId,
      ),
    )
    expect(res.status).toBe(200)
    await expect
      .poll(() => checkFor(pr.sha)?.conclusion, { timeout: 30_000 })
      .toBe('action_required')
    expect(comment.reactions).toContain('+1')
  })

  const workspaceFlaky = (flakyBlocksMerge: boolean) =>
    ctx.setup.session.patch(`/api/workspaces/${workspace}/settings`, { flakyBlocksMerge })

  describe('a pull request that only changes a flaky screenshot', () => {
    // `login` flips between two images on main (100, 200, 100, 200, 100: three returns to an earlier
    // image), so it is flagged as flaky (see flaky.browser.e2e.test.ts); the pull requests below
    // change nothing else, and only to an image it already had there (the gate also needs the
    // change to look like known variation). The workspace's switch is global to this file's
    // workspace, so it is put back at the end.
    let flaky: LinkedProject
    let prs = 50

    beforeAll(async () => {
      const { stack, setup } = ctx
      flaky = await createLinkedProject(stack, setup.session, workspace, 'Flaky', {
        repoRef: 'acme/flaky',
      })
      for (const x of [100, 200, 100, 200, 100]) {
        // oxlint-disable-next-line no-await-in-loop -- builds on main are sequential
        await flaky.repo.checkout('main')
        // oxlint-disable-next-line no-await-in-loop
        await flaky.repo.writeShots({ login: { dot: { x, y: 60 } } })
        // oxlint-disable-next-line no-await-in-loop
        await flaky.repo.commit(`main: login at ${x}`)
        // oxlint-disable-next-line no-await-in-loop
        await uploadOrThrow({ stack, token: flaky.token, repo: flaky.repo, wait: true })
      }
      const report = await setup.session.get<{ flaky: { name: string }[] }>(
        `/api/projects/${workspace}/${flaky.slug}/flaky`,
      )
      if (report.flaky.map((f) => f.name).join() !== 'login') {
        throw new Error(`expected only login to be flaky, got ${JSON.stringify(report.flaky)}`)
      }
    })

    afterAll(async () => {
      await ctx.setup.session.patch(`/api/workspaces/${workspace}/settings`, {
        flakyBlocksMerge: true,
      })
    })

    const projectFlaky = (flakyBlocksMerge: boolean | null) =>
      ctx.setup.session.patch(`/api/projects/${workspace}/${flaky.slug}/settings`, {
        flakyBlocksMerge,
      })

    /** A pull request that puts `login` at the image main had before, and what its check and `--wait` said. */
    async function flakyPr() {
      prs += 1
      const pr = await uploadPr(ctx.stack, flaky, prs, { login: { dot: { x: 200, y: 60 } } })
      await settle(pr.sha)
      const detail = await buildDetail(ctx.setup.session, flaky, pr.buildNumber)
      // The dashboard still says "changed": flaky is a grouping, not a status.
      expect(
        detail.diffs.map((d) => [d.name, d.status]).filter(([, s]) => s !== 'unchanged'),
      ).toEqual([['login', 'changed']])
      return { pr, check: checkFor(pr.sha), outcome: pr.upload?.status?.outcome }
    }

    it('blocks the merge by default, as any other change does', async () => {
      const { check, outcome } = await flakyPr()
      expect(check).toMatchObject({
        conclusion: 'action_required',
        title: '1 changed: review required',
      })
      expect(outcome).toMatchObject({ state: 'fail' })
    })

    it('passes once the workspace stops blocking on flaky screenshots, saying why', async () => {
      await workspaceFlaky(false)
      const { check, outcome, pr } = await flakyPr()
      expect(check).toMatchObject({
        conclusion: 'success',
        title: 'Only flaky screenshots changed (1 changed)',
      })
      expect(check?.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
      expect(outcome).toMatchObject({ state: 'pass', summary: 'Only flaky screenshots changed' })
      expect(pr.exitCode).toBe(0)
    })

    it('a change to a steady screenshot next to the flaky one still blocks', async () => {
      await workspaceFlaky(false)
      prs += 1
      const pr = await uploadPr(ctx.stack, flaky, prs, {
        login: { dot: { x: 320, y: 90 } },
        home: { dot: { x: 12, y: 12 } },
      })
      await settle(pr.sha)
      expect(checkFor(pr.sha)).toMatchObject({
        conclusion: 'action_required',
        title: '2 changed: review required',
      })
    })

    it('a project can override the workspace in either direction', async () => {
      await workspaceFlaky(false)
      await projectFlaky(true)
      expect((await flakyPr()).check?.conclusion).toBe('action_required')

      await workspaceFlaky(true)
      await projectFlaky(false)
      const passing = await flakyPr()
      expect(passing.check?.conclusion).toBe('success')
      expect(passing.outcome).toMatchObject({ state: 'pass' })

      // Back to inheriting: the workspace's value (blocking) applies again.
      await projectFlaky(null)
      expect((await flakyPr()).check?.conclusion).toBe('action_required')
    })
  })

  it('approved in the CirCI UI: the same check run turns success within seconds, offering Reject', async () => {
    const { stack, setup } = ctx
    const pr = await uploadPr(stack, blocking, 33, { login: { dot: { x: 250, y: 100 } } })
    await settle(pr.sha)
    const id = checkFor(pr.sha)?.id
    expect(checkFor(pr.sha)?.conclusion).toBe('action_required')
    await setup.session.post(
      `/api/projects/${workspace}/${blocking.slug}/builds/${pr.buildNumber}/review`,
      {
        state: 'approved',
      },
    )
    await expect.poll(() => checkFor(pr.sha)?.conclusion, { timeout: 30_000 }).toBe('success')
    const run = checkFor(pr.sha)!
    expect(run.id).toBe(id)
    expect(run.title).toBe('Changes approved (1 changed)')
    expect(run.actions.map((a) => a.identifier)).toEqual(['reject'])
    expect(gh.find(`PATCH /repos/acme/blocking/check-runs/${id}`).length).toBeGreaterThan(0)
    await expect
      .poll(() => gh.comments.find((c) => c.prNumber === 33)?.body)
      .toContain('✅ Approved')
    // The CLI re-run on the same commit is approved at once: exit 0 even on the CI-job gate.
    const again = await uploadBuild({
      stack,
      token: blocking.token,
      repo: blocking.repo,
      wait: true,
      gate: 'exit-code',
      pr: { number: 33 },
    })
    expect(again.exitCode).toBe(0)
  })

  it('rejected in the UI: failure, offering Approve; the CI-job gate fails too', async () => {
    const { stack, setup } = ctx
    const pr = await uploadPr(stack, lenient, 34, { login: { dot: { x: 260, y: 100 } } })
    await settle(pr.sha)
    await setup.session.post(
      `/api/projects/${workspace}/${lenient.slug}/builds/${pr.buildNumber}/review`,
      {
        state: 'rejected',
      },
    )
    await expect.poll(() => checkFor(pr.sha)?.conclusion, { timeout: 30_000 }).toBe('failure')
    expect(checkFor(pr.sha)).toMatchObject({ title: 'Changes rejected (1 changed)' })
    expect(checkFor(pr.sha)?.actions.map((a) => a.identifier)).toEqual(['approve'])
    const detail = await buildDetail(setup.session, lenient, pr.buildNumber)
    expect(detail.build.reviewStatus).toBe('rejected')
  })

  it('--wait exit codes follow the gate: status gate exits 0 with changes, exit-code gate exits 1', async () => {
    const { stack } = ctx
    const status = await uploadPr(
      stack,
      blocking,
      35,
      { login: { dot: { x: 270, y: 100 } } },
      { gate: 'status' },
    )
    expect(status.exitCode).toBe(0)
    expect(status.upload?.status?.outcome).toMatchObject({ state: 'fail' })
    const exit = await uploadPr(
      stack,
      blocking,
      36,
      { login: { dot: { x: 280, y: 100 } } },
      { gate: 'exit-code' },
    )
    expect(exit.exitCode).toBe(1)
    // Default for a linked project is the check (exit 0); a project without a repository
    // has the CI job as the gate (exit 1), and `--gate status` flips it.
    const plain = await createProject(ctx.setup.session, workspace, 'Unlinked')
    const repo = await Repo.create()
    try {
      await repo.writeShots({ home: {} })
      await repo.commit('base')
      // Its first build waits for review (no baseline), so the CI-job gate fails until approved.
      const first = await uploadOrThrow({ stack, token: plain.token, repo, wait: true })
      expect(first.exitCode).toBe(1)
      await approveBuild(ctx.setup.session, workspace, plain.slug, first.build.number)
      await repo.checkout('feature', { create: true })
      await repo.writeShots({ home: { dot: { x: 9, y: 9 } } })
      await repo.commit('change')
      await repo.fetch()
      const pr = { number: 7 }
      const dflt = await uploadBuild({ stack, token: plain.token, repo, wait: true, pr })
      expect(dflt.exitCode).toBe(1)
      const flipped = await uploadBuild({
        stack,
        token: plain.token,
        repo,
        wait: true,
        pr,
        gate: 'status',
      })
      expect(flipped.exitCode).toBe(0)
    } finally {
      await repo.destroy()
    }
    // Nothing was reported to GitHub for the unlinked project.
    expect(gh.checkRuns.some((c) => c.repo.includes('unlinked'))).toBe(false)
  })

  it('an undecodable screenshot: failure when blocking, neutral when not', async () => {
    const { stack } = ctx
    const broken = async (p: LinkedProject, n: number) => {
      await p.repo.checkout('main')
      await p.repo.checkout(`broken-${n}`, { create: true })
      await writeFile(join(p.repo.shots, 'login.png'), Buffer.from('definitely not a png'))
      const sha = await p.repo.commit('broken')
      await p.repo.fetch()
      const run = await uploadBuild({
        stack,
        token: p.token,
        repo: p.repo,
        wait: true,
        pr: { number: n },
      })
      return { sha, run }
    }
    const hard = await broken(blocking, 40)
    const soft = await broken(lenient, 40)
    await settle(hard.sha)
    await settle(soft.sha)
    // An input problem no review settles, so no Approve or Reject; like a build that errors as a
    // whole it follows the blocking setting: a failed check and exit 2 when blocking, a neutral
    // check and exit 0 (warned) when not.
    expect(checkFor(hard.sha)).toMatchObject({
      conclusion: 'failure',
      title: "1 screenshot couldn't be read",
      actions: [],
    })
    expect(checkFor(soft.sha)).toMatchObject({ conclusion: 'neutral' })
    expect(hard.run.exitCode).toBe(2)
    expect(soft.run.exitCode).toBe(0)
    // What the CLI says: the file is named either way, and the project that doesn't block merges
    // is told so in a warning, not an error that fails the job.
    expect(hard.run.stderr).toMatch(/error: login/)
    expect(soft.run.stderr).toMatch(/error: login/)
    expect(soft.run.stderr).toContain(
      "warning: 1 screenshot couldn't be read; merges aren't blocked for this project",
    )
    expect(hard.run.stderr).not.toContain('merges aren')
    expect(soft.run.result?.status?.outcome).toMatchObject({
      state: 'pass',
      summary: "1 screenshot couldn't be read",
    })
    expect(checkFor(soft.sha)?.actions).toEqual([])
  })

  it('a build that errors as a whole: failure when blocking, neutral when not', async () => {
    const { stack } = ctx
    // The worker only marks a build `error` after exhausting retries or a stalled upload, both
    // minutes long; so put the build in the state `failBuild` leaves it in and queue the notice
    // the same way the service does.
    const errored = async (p: LinkedProject, n: number) => {
      const pr = await uploadPr(stack, p, n, { login: { dot: { x: 90 + n, y: 90 } } })
      await stack.sql(
        `update builds set status = 'error', error_message = 'Timed out waiting for 1 of 2 shard(s): shard 2.' where id = '${pr.buildId}'`,
      )
      await stack.sql(
        `insert into jobs (queue, payload, dedupe_key) values ('git-notify', '{"buildId":"${pr.buildId}"}', 'e2e-error-${pr.buildId}')`,
      )
      return pr
    }
    const hard = await errored(blocking, 41)
    const soft = await errored(lenient, 41)
    await expect.poll(() => checkFor(hard.sha)?.conclusion, { timeout: 30_000 }).toBe('failure')
    await expect.poll(() => checkFor(soft.sha)?.conclusion, { timeout: 30_000 }).toBe('neutral')
    expect(checkFor(hard.sha)).toMatchObject({ title: 'Processing failed', actions: [] })
    expect(checkFor(hard.sha)?.summary).toContain('Timed out waiting for 1 of 2 shard(s)')
    expect(
      gh.comments.find((c) => c.prNumber === 41 && c.repo === 'acme/blocking')?.body,
    ).toContain('Failed')
  })

  it('a project with no baseline yet: every screenshot is new and waits for review', async () => {
    const { stack, setup } = ctx
    const project = await createProject(setup.session, workspace, 'Fresh')
    await setup.session.put(`/api/projects/${workspace}/${project.slug}/github`, {
      installationId: uniqueInstallationId(),
      repoRef: 'acme/fresh',
    })
    const repo = await Repo.create()
    try {
      await repo.writeShots({ home: {} })
      const sha = await repo.commit('first ever')
      const up = await uploadBuild({
        stack,
        token: project.token,
        repo,
        wait: true,
        pr: { number: 1 },
      })
      expect(up.exitCode).toBe(0)
      await settle(sha)
      // Product rule (render.ts): with nothing to compare against, every screenshot is "added"
      // and an unreviewed change: held like any other (there is no neutral state for orphans).
      expect(checkFor(sha)).toMatchObject({
        conclusion: 'action_required',
        title: '1 added: review required',
      })
    } finally {
      await repo.destroy()
    }
  })
})
