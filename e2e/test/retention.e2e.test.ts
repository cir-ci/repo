import type { Build } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTeam, type CreatedTeam } from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import { fileRows, noisePng, parseJsonOutput, sha256Hex } from '#src/storage.ts'
import { uploadOrThrow } from '#src/upload.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

interface Retention {
  expiredBuilds: number
  expiredSites: { addresses: number; versions: number }
  unmarked: number
  marked: number
  deleted: number
  kept: number
}

/**
 * Retention end to end: expire, mark, grace period, re-check, delete. The real clock cannot be
 * sped up, so the tests move time the way an operator's calendar would: `created_at` of builds
 * and `gc_marked_at` of files are back-dated in Postgres (`stack.sql`), and `storage gc
 * --grace-hours 1` runs the same pass the worker runs every six hours. (The stack's default
 * `GC_GRACE_HOURS=0` would delete at once.)
 */
describe('retention and garbage collection', () => {
  const ctx = useStack({ dedicated: true, setup: true })
  const browser = useBrowser()
  let repo: Repo
  let team: CreatedTeam
  const shots = {
    shared: undefined as Buffer | undefined,
    mine: undefined as Buffer | undefined,
  }
  let first: uploadOrThrow.Result
  let third: uploadOrThrow.Result

  const root = '/var/lib/circi/files'
  const onDisk = async (key: string) =>
    (await ctx.stack.exec('circi', ['test', '-f', `${root}/${key}`], { allowFail: true })).code ===
    0
  const gc = async () =>
    parseJsonOutput<Retention>(await ctx.stack.cli('storage', 'gc', '--grace-hours', '1'))
  const rowOf = async (bytes: Buffer) =>
    (await fileRows(ctx.stack, `sha256 = '${sha256Hex(bytes)}'`))[0]
  const upload = () => uploadOrThrow({ stack: ctx.stack, token: team.token, repo, wait: true })
  const status = async (n: number) =>
    (
      await ctx.setup.session.get<Build.Detail>(
        `/api/teams/${ctx.setup.workspace.slug}/${team.slug}/builds/${n}`,
      )
    ).build.status
  const backdateBuild = (sha: string) =>
    ctx.stack.sql(
      `update builds set created_at = now() - interval '30 days' where commit_sha = '${sha}'`,
    )

  beforeAll(async () => {
    repo = await Repo.create()
    team = await createTeam(ctx.setup.session, ctx.setup.workspace.slug, 'Retained')
    await ctx.setup.session.patch(`/api/teams/${ctx.setup.workspace.slug}/${team.slug}/settings`, {
      retentionDays: 7,
    })
  })
  afterAll(async () => {
    await repo.destroy()
  })

  it('expires an old branch build, keeps what other builds still use, and marks the rest', async () => {
    const shared = await noisePng(50, 11)
    const mine = await noisePng(50, 12)
    shots.shared = shared
    shots.mine = mine
    // The default branch's baseline uses `shared`.
    await repo.writeShots({ shared })
    await repo.commit('baseline')
    await upload()
    // An old feature build: `shared` plus a screenshot nothing else has.
    await repo.checkout('feature', { create: true })
    await repo.writeShots({ mine })
    first = await (async () => {
      await repo.commit('old feature build')
      return upload()
    })()
    // A recent feature build that also uses `shared`.
    await repo.removeShot('mine')
    await repo.writeShots({ other: await noisePng(50, 13) })
    await repo.commit('recent feature build')
    const recent = await upload()

    const mineRow = await rowOf(mine)
    expect(mineRow?.markedAt).toBeNull()
    await backdateBuild(first.ci.commitSha)

    const result = await gc()
    expect(result.expiredBuilds).toBe(1)
    expect(result.marked).toBeGreaterThanOrEqual(1)
    expect(result.deleted).toBe(0) // inside the grace period

    expect(await status(first.build.number)).toBe('expired')
    expect(await status(recent.build.number)).toBe('complete')
    // Marked, but still on disk and in the database until the grace period has passed.
    expect((await rowOf(mine))?.markedAt).not.toBeNull()
    expect(await onDisk(mineRow?.storageKey ?? '')).toBe(true)
    // Used by the baseline and the recent build: untouched.
    const sharedRow = await rowOf(shared)
    expect(sharedRow?.markedAt).toBeNull()
    expect(await onDisk(sharedRow?.storageKey ?? '')).toBe(true)

    const usage = parseJsonOutput<{ markedForDeletion: { count: number } }>(
      await ctx.stack.cli('storage', 'usage', '--json'),
    )
    expect(usage.markedForDeletion.count).toBe(result.marked)
  })

  it('shows an expired build as expired in the dashboard', async () => {
    const page = await browser.as(ctx.setup.session)
    await page.goto(
      `${ctx.stack.url}/${ctx.setup.workspace.slug}/${team.slug}/builds/${first.build.number}`,
    )
    await page.getByText('This build has expired').waitFor()
    await page
      .getByText('Its screenshots were deleted under the team’s retention policy.')
      .waitFor()
    expect(await page.getByRole('navigation', { name: 'Screenshots' }).count()).toBe(0)
  })

  it('keeps a file that is uploaded again during the grace period', async () => {
    const mine = shots.mine ?? Buffer.alloc(0)
    const row = await rowOf(mine)
    // The grace period has passed for everything marked so far...
    await ctx.stack.sql(
      `update files set gc_marked_at = now() - interval '2 hours' where gc_marked_at is not null`,
    )
    // ...but before the next pass a new build uses the same screenshot again.
    await repo.checkout('again', { create: true })
    await repo.writeShots({ mine })
    await repo.commit('uploaded again')
    third = await upload()
    expect(third.deduplicated).toBeGreaterThanOrEqual(1)

    const result = await gc()
    expect(result.unmarked).toBeGreaterThanOrEqual(1)
    expect((await rowOf(mine))?.markedAt).toBeNull()
    expect(await onDisk(row?.storageKey ?? '')).toBe(true)
    const res = await fetch(`${ctx.stack.url}/api/files/${sha256Hex(mine)}`, {
      headers: { cookie: ctx.setup.session.cookieHeader },
    })
    expect(res.status).toBe(200)
  })

  it('deletes the file and its object once nothing uses it and the grace period has passed', async () => {
    const mine = shots.mine ?? Buffer.alloc(0)
    const row = await rowOf(mine)
    await backdateBuild(third.ci.commitSha)
    const marking = await gc()
    expect(marking.expiredBuilds).toBe(1)
    expect((await rowOf(mine))?.markedAt).not.toBeNull()
    expect(marking.deleted).toBe(0)

    await ctx.stack.sql(
      `update files set gc_marked_at = now() - interval '2 hours' where gc_marked_at is not null`,
    )
    // A dry run names the file and its key, and deletes and marks nothing.
    const dry = await ctx.stack.cli('storage', 'gc', '--grace-hours', '1', '--dry-run')
    expect(dry).toContain('Would delete')
    expect(dry).toContain(row?.storageKey ?? 'missing')
    expect(await rowOf(mine)).toBeDefined()
    expect(await onDisk(row?.storageKey ?? '')).toBe(true)

    const collecting = await gc()
    expect(collecting.deleted).toBeGreaterThanOrEqual(1)
    expect(await rowOf(mine)).toBeUndefined()
    expect(await onDisk(row?.storageKey ?? '')).toBe(false)
    // The baseline's file is still there and served.
    const shared = shots.shared ?? Buffer.alloc(0)
    expect(await onDisk((await rowOf(shared))?.storageKey ?? '')).toBe(true)
    const res = await fetch(`${ctx.stack.url}/api/files/${sha256Hex(shared)}`, {
      headers: { cookie: ctx.setup.session.cookieHeader },
    })
    expect(res.status).toBe(200)
  })
})
