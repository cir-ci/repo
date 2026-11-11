import {
  addTestMember,
  addTestProjectMember,
  createTestDb,
  seedBuild,
  seedDiff,
  seedReviewRequest,
  seedScreenshot,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { searchWorkspace } from '#src/queries/index.ts'
import { createProject } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

let run = 0
/** Emails are unique in the database, which every test shares: each setup adds its own number. */
const rename = (id: string, name: string, email: string) =>
  t.db
    .update(schema.user)
    .set({ name, email: email.replace('@', `${run}@`) })
    .where(eq(schema.user.id, id))

/**
 * Projects `open` and `secret`. The owner is in both; Olive (a plain member) only in `open`; Pat in
 * both; Sam only in `secret`; Nora in no project at all.
 */
async function setup() {
  run += 1
  const first = await seedProject(t.db, { slug: 'open' })
  const { workspace, owner } = first
  const secret = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
  await addTestProjectMember(t.db, { projectId: secret.id, userId: owner.id })
  const person = async (name: string, email: string, projects: string[]) => {
    const u = await seedUser(t.db)
    await rename(u.id, name, email)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id, projects })
    return u
  }
  const olive = await person('Olive Outsider', 'olive@corp.test', [first.project.id])
  const pat = await person('Pat Both', 'pat@corp.test', [first.project.id, secret.id])
  const sam = await person('Sam Secret', 'sam@corp.test', [secret.id])
  const nora = await person('Nora Nowhere', 'nora@corp.test', [])
  const openBuild = await seedBuild(t.db, first.project.id, {
    branch: 'feat/a',
    status: 'complete',
  })
  const secretBuild = await seedBuild(t.db, secret.id, { branch: 'feat/b', status: 'complete' })
  await seedReviewRequest(t.db, {
    buildId: openBuild.id,
    reviewerId: pat.id,
    requestedById: owner.id,
  })
  await seedReviewRequest(t.db, {
    buildId: secretBuild.id,
    reviewerId: pat.id,
    requestedById: owner.id,
  })
  const search = (userId: string, query: string, project?: string) =>
    searchWorkspace(t.db, {
      userId,
      workspaceSlug: workspace.slug,
      query,
      kinds: ['people'],
      ...(project ? { project } : {}),
    })
  return { workspace, owner, olive, pat, sam, nora, openBuild, secretBuild, search, first, secret }
}

describe('people search', () => {
  it('matches the name and the email, prefixes first, with avatar data', async () => {
    const s = await setup()
    const byName = await s.search(s.owner.id, 'pat')
    expect(byName?.people).toMatchObject([
      {
        id: s.pat.id,
        name: 'Pat Both',
        email: expect.stringMatching(/^pat\d+@corp\.test$/),
        image: null,
      },
    ])
    expect(byName?.totals.people).toBe(1)
    // "corp" is in every email; the prefix match on a name comes before one inside an email.
    const byEmail = await s.search(s.owner.id, 'olive')
    expect(byEmail?.people.map((p) => p.name)).toEqual(['Olive Outsider'])
    const ranked = await s.search(s.owner.id, 'o')
    expect(ranked?.people[0]?.name).toMatch(/^(Olive|Owner)/)
    // Other kinds stay empty when only people are asked for.
    expect(byName?.builds).toEqual([])
  })

  it('lists projects and open review requests of the person, as the searcher may see them', async () => {
    const s = await setup()
    const asOwner = await s.search(s.owner.id, 'pat')
    expect(asOwner?.people[0]).toMatchObject({
      projects: [
        { slug: 'open', name: 'open' },
        { slug: 'secret', name: 'secret' },
      ],
      openReviews: 2,
    })
    // Olive can't see `secret`: neither its name nor its review request leaks through Pat.
    const asOlive = await s.search(s.olive.id, 'pat')
    expect(asOlive?.people[0]?.projects.map((x) => x.slug)).toEqual(['open'])
    expect(asOlive?.people[0]?.openReviews).toBe(1)
    expect(JSON.stringify(asOlive)).not.toContain('secret')
  })

  it('does not show a person who is only in projects the searcher cannot see', async () => {
    const s = await setup()
    expect((await s.search(s.olive.id, 'sam'))?.people).toEqual([])
    expect((await s.search(s.olive.id, 'sam'))?.totals.people).toBe(0)
    // An owner sees everyone, including a member of no project.
    expect((await s.search(s.owner.id, 'sam'))?.people).toHaveLength(1)
    expect((await s.search(s.owner.id, 'nora'))?.people).toHaveLength(1)
    // Someone who is in no project sees nobody but themself, and the search still works.
    expect((await s.search(s.nora.id, 'olive'))?.people).toEqual([])
    expect((await s.search(s.nora.id, 'nora'))?.people).toHaveLength(1)
    // A plain member always finds themself.
    expect((await s.search(s.olive.id, 'olive'))?.people).toHaveLength(1)
  })

  it("keeps to the project's members when the search is scoped, and finds none in a hidden project", async () => {
    const s = await setup()
    const names = async (userId: string, q: string, project: string) =>
      (await s.search(userId, q, project))?.people.map((p) => p.name)
    expect(await names(s.owner.id, 'o', 'secret')).toEqual(expect.arrayContaining([]))
    expect(await names(s.owner.id, 'sam', 'secret')).toEqual(['Sam Secret'])
    expect(await names(s.owner.id, 'olive', 'secret')).toEqual([])
    expect(await names(s.olive.id, 'pat', 'open')).toEqual(['Pat Both'])
    // The hidden project is not there for Olive, so nobody of it is either.
    expect(await names(s.olive.id, 'sam', 'secret')).toEqual([])
    expect(await names(s.olive.id, 'pat', 'secret')).toEqual([])
    expect(await names(s.olive.id, 'pat', 'no-such-project')).toEqual([])
  })
})

describe('search peeks', () => {
  it('gives a build its change counts and its largest change as a thumbnail', async () => {
    const s = await setup()
    const head = await seedScreenshot(t.db, {
      buildId: s.openBuild.id,
      name: 'home',
      fileSha256: fakeSha('1'),
      thumbnailSha256: fakeSha('2'),
    })
    const diff = await seedDiff(t.db, { buildId: s.openBuild.id, name: 'home', status: 'changed' })
    await t.db
      .update(schema.screenshotDiffs)
      .set({ headScreenshotId: head.id, score: 0.4 })
      .where(eq(schema.screenshotDiffs.id, diff.id))
    await seedDiff(t.db, { buildId: s.openBuild.id, name: 'new', status: 'added' })
    await seedDiff(t.db, { buildId: s.openBuild.id, name: 'gone', status: 'removed' })
    const found = await searchWorkspace(t.db, {
      userId: s.owner.id,
      workspaceSlug: s.workspace.slug,
      query: `#${s.openBuild.number}`,
      project: 'open',
    })
    expect(found?.builds[0]).toMatchObject({
      changes: { changed: 1, added: 1, removed: 1 },
      thumbnail: fakeSha('2'),
    })
    // Screenshots and baselines get a thumbnail, baselines also who approved them.
    const main = await seedBuild(t.db, s.first.project.id, {
      branch: 'main',
      status: 'complete',
      reviewStatus: 'approved',
    })
    await seedScreenshot(t.db, {
      buildId: main.id,
      name: 'pricing/table',
      fileSha256: fakeSha('3'),
      thumbnailSha256: fakeSha('4'),
    })
    await t.db
      .insert(schema.reviews)
      .values({ buildId: main.id, userId: s.pat.id, state: 'approved', source: 'ui' })
    const shots = await searchWorkspace(t.db, {
      userId: s.owner.id,
      workspaceSlug: s.workspace.slug,
      query: 'pricing',
      project: 'open',
    })
    expect(shots?.snapshots[0]).toMatchObject({ thumbnail: fakeSha('4') })
    expect(shots?.baselines[0]).toMatchObject({ thumbnail: fakeSha('4'), approvedBy: 'Pat Both' })
    // A review request carries when it was asked.
    const asked = await searchWorkspace(t.db, {
      userId: s.owner.id,
      workspaceSlug: s.workspace.slug,
      query: 'Pat',
      kinds: ['reviews'],
    })
    expect(asked?.reviews[0]?.createdAt).toBeInstanceOf(Date)
    // A build with no diffs has no thumbnail and zero counts.
    const other = await searchWorkspace(t.db, {
      userId: s.owner.id,
      workspaceSlug: s.workspace.slug,
      query: `#${s.secretBuild.number}`,
      project: 'secret',
    })
    expect(other?.builds[0]).toMatchObject({
      changes: { changed: 0, added: 0, removed: 0 },
      thumbnail: null,
    })
  })
})
