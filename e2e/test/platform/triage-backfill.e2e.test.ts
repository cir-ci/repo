import type { Triage } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '#clients/admin.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

const MARKER = 'triage_problems_backfilled'

/**
 * The triage backfill on a real database and a real worker process: `triage_problems` is derived
 * from builds by rules in code, so a database that predates the table has builds and no rows until
 * the worker's first start fills them in (`backfillTriageProblems`, once per database, guarded by a
 * marker and by a try-lock). Dedicated stack: restarting the app container is instance-wide.
 */
describe('triage backfill (real Postgres, worker restarted)', () => {
  const ctx = useStack({ dedicated: true, setup: true })
  let repo: Repo
  let project: CreatedProject

  const workspace = () => ctx.setup.workspace.slug
  const stored = async () =>
    (
      await ctx.stack.sql(
        `select t.kind, t.key from triage_problems t join projects p on p.id = t.project_id join workspace w on w.id = p.workspace_id where w.slug = '${workspace()}' and p.slug = '${project.slug}' order by t.kind, t.key`,
      )
    ).map(([kind, key]) => `${kind}:${key}`)
  const queue = async () =>
    (
      await ctx.setup.session.get<Triage.Queue>(
        `/api/projects/${workspace()}/${project.slug}/triage`,
      )
    ).items
      .map((i) => `${i.kind}:${i.key}`)
      .toSorted()
  const marker = async () =>
    (await ctx.stack.sql(`select value from instance_settings where key = '${MARKER}'`))[0]?.[0]

  beforeAll(async () => {
    repo = await Repo.create()
    project = await createProject(ctx.setup.session, workspace(), 'Backfilled')
    // Two screenshots on the default branch, with nothing to compare against: two items nobody
    // has dealt with (`no_baseline`), and a project that already has a rule-derived queue.
    await repo.writeShots({ home: {}, pricing: { dot: { x: 40, y: 40 } } })
    await repo.commit('first')
    await uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait: true })
  })
  afterAll(async () => {
    await repo.destroy()
  })

  it('fills the rows of a database that has builds and no rows, once, and the queue matches them', async () => {
    // What the worker maintained while it ran is what the rules say.
    expect(await stored()).toEqual(['no_baseline:home', 'no_baseline:pricing'])
    expect(await queue()).toEqual(['no_baseline:home', 'no_baseline:pricing'])

    // A database from before the table: builds, no rows, no marker.
    await ctx.stack.sql(`delete from triage_problems`)
    await ctx.stack.sql(`delete from instance_settings where key = '${MARKER}'`)
    expect(await stored()).toEqual([])
    expect(await marker()).toBeUndefined()

    // The worker's start runs the backfill.
    await ctx.stack.restart('circi')
    await expect
      .poll(stored, { timeout: 30_000 })
      .toEqual(['no_baseline:home', 'no_baseline:pricing'])
    expect(await queue()).toEqual(await stored())
    // It says it is done, so the next start leaves everything alone.
    await expect.poll(marker, { timeout: 10_000 }).toBeDefined()
    expect(await ctx.stack.logs('circi')).toContain(
      'filled in the triage counts of existing projects',
    )
  })

  it('run again (marker cleared, rows present) it changes nothing and duplicates nothing', async () => {
    const before = await ctx.stack.sql(
      `select project_id, kind, key from triage_problems order by 1, 2, 3`,
    )
    expect(before).toHaveLength(2)
    await ctx.stack.sql(`delete from instance_settings where key = '${MARKER}'`)
    await ctx.stack.restart('circi')
    await expect.poll(marker, { timeout: 30_000 }).toBeDefined()
    expect(
      await ctx.stack.sql(`select project_id, kind, key from triage_problems order by 1, 2, 3`),
    ).toEqual(before)
    expect(await queue()).toEqual(['no_baseline:home', 'no_baseline:pricing'])
  })
})
