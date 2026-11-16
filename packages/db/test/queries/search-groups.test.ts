import {
  addTestMember,
  addTestProjectMember,
  createTestDb,
  seedBuild,
  seedNotification,
  seedReviewRequest,
  seedSavedView,
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

const now = new Date('2026-03-10T12:00:00.000Z')

/**
 * Project `open` (the owner and `outsider` are in it) and `secret` (the owner only; the outsider has
 * notifications, a review request and a view about it from before they were removed).
 */
async function setup() {
  const first = await seedProject(t.db, { slug: 'open' })
  const { workspace, owner } = first
  const secret = await createProject(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
  await addTestProjectMember(t.db, { projectId: secret.id, userId: owner.id })
  const outsider = await seedUser(t.db)
  await t.db
    .update(schema.user)
    .set({ name: 'Olive Outsider' })
    .where(eq(schema.user.id, outsider.id))
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: outsider.id,
    projects: [first.project.id],
  })

  const shipped = await seedBuild(t.db, first.project.id, {
    branch: 'main',
    status: 'complete',
    conclusion: 'no_changes',
    reviewStatus: 'approved',
    name: 'mobile',
    prNumber: 42,
    commitSha: 'abc1234ffff',
  })
  await t.db
    .update(schema.builds)
    .set({ authorLogin: 'octocat' })
    .where(eq(schema.builds.id, shipped.id))
  await seedScreenshot(t.db, {
    buildId: shipped.id,
    name: 'checkout/summary',
    fileSha256: fakeSha('a'),
  })
  const broken = await seedBuild(t.db, first.project.id, { branch: 'main', status: 'error' })
  await seedNotification(t.db, {
    userId: outsider.id,
    kind: 'build_rejected',
    buildId: shipped.id,
    actorId: owner.id,
    payload: { reason: 'spacing is off' },
  })
  const request = await seedReviewRequest(t.db, {
    buildId: shipped.id,
    reviewerId: outsider.id,
    requestedById: owner.id,
  })
  const view = await seedSavedView(t.db, {
    userId: outsider.id,
    workspaceId: workspace.id,
    name: 'Checkout reviews',
  })

  const hidden = await seedBuild(t.db, secret.id, {
    branch: 'main',
    status: 'complete',
    conclusion: 'no_changes',
    reviewStatus: 'approved',
    name: 'secretive',
    commitSha: 'feed999',
  })
  await seedScreenshot(t.db, {
    buildId: hidden.id,
    name: 'checkout/hidden',
    fileSha256: fakeSha('b'),
  })
  await seedBuild(t.db, secret.id, { branch: 'main', status: 'error' })
  await seedNotification(t.db, {
    userId: outsider.id,
    kind: 'build_approved',
    buildId: hidden.id,
    actorId: owner.id,
  })
  await seedReviewRequest(t.db, {
    buildId: hidden.id,
    reviewerId: outsider.id,
    requestedById: owner.id,
  })
  await seedSavedView(t.db, {
    userId: outsider.id,
    workspaceId: workspace.id,
    projectId: secret.id,
    name: 'Checkout secret view',
  })
  const search = (userId: string, query: string) =>
    searchWorkspace(t.db, { userId, workspaceSlug: workspace.slug, query, now })
  return { owner, outsider, workspace, secret, first, shipped, broken, request, view, search }
}

describe('searchWorkspace groups', () => {
  it('finds builds by name, commit prefix, PR number and author', async () => {
    const s = await setup()
    const names = async (q: string) => (await s.search(s.owner.id, q))?.builds.map((b) => b.name)
    expect(await names('mobile')).toEqual(['mobile'])
    expect(await names('abc12')).toEqual(['mobile'])
    expect(await names('42')).toEqual(['mobile'])
    expect(await names('octo')).toEqual(['mobile'])
    // "default" is the name of nearly every build and matches nothing by itself.
    expect(await names('default')).toEqual([])
  })

  it('ranks an exact build number ahead of a pull request with the same number', async () => {
    const { project, workspace, owner } = await seedProject(t.db, { slug: 'rank' })
    await seedBuild(t.db, project.id, { prNumber: 2 })
    await seedBuild(t.db, project.id)
    const found = await searchWorkspace(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      query: '2',
    })
    expect(found?.builds.map((b) => [b.number, b.prNumber])).toEqual([
      [2, null],
      [1, 2],
    ])
  })

  it('ranks exact, prefix and segment matches of screenshot names before the rest', async () => {
    const { project, workspace, owner } = await seedProject(t.db, { slug: 'rank-names' })
    const b = await seedBuild(t.db, project.id)
    const names = ['about-cart', 'ui/cart', 'cart-page', 'cart']
    for (const [i, name] of names.entries()) {
      // eslint-disable-next-line no-await-in-loop -- sequential seeding
      await seedScreenshot(t.db, { buildId: b.id, name, fileSha256: fakeSha(`d${i}`) })
    }
    const found = await searchWorkspace(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      query: 'cart',
    })
    expect(found?.snapshots.map((x) => x.name)).toEqual([
      'cart',
      'cart-page',
      'ui/cart',
      'about-cart',
    ])
  })

  it('finds baselines on the default branch and not screenshots of other branches', async () => {
    const s = await setup()
    const found = await s.search(s.owner.id, 'summary')
    expect(found?.baselines).toMatchObject([
      { projectSlug: 'open', name: 'checkout/summary', buildNumber: 1 },
    ])
    const { project, workspace, owner } = await seedProject(t.db, { slug: 'feature-only' })
    const b = await seedBuild(t.db, project.id, { branch: 'feature/x', status: 'complete' })
    await seedScreenshot(t.db, {
      buildId: b.id,
      name: 'only-on-a-branch',
      fileSha256: fakeSha('c'),
    })
    const other = await searchWorkspace(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      query: 'only-on',
    })
    expect(other?.baselines).toEqual([])
    expect(other?.snapshots).toHaveLength(1)
  })

  it('finds triage items by kind and build number', async () => {
    const s = await setup()
    const found = await s.search(s.owner.id, 'failed')
    expect(found?.triage.map((i) => [i.projectSlug, i.kind]).toSorted()).toEqual([
      ['open', 'failed'],
      ['secret', 'failed'],
    ])
    const byNumber = await s.search(s.owner.id, `#${s.broken.number}`)
    expect(byNumber?.triage.find((i) => i.projectSlug === 'open')).toMatchObject({
      kind: 'failed',
      key: `build:${s.broken.number}`,
      snapshotName: null,
      branch: 'main',
    })
  })

  it('marks a snoozed triage item and lists it after the awake ones', async () => {
    const s = await setup()
    const awake = await s.search(s.owner.id, 'failed')
    expect(awake?.triage.map((i) => i.snoozed)).toEqual([false, false])
    await t.db.insert(schema.triageItems).values({
      projectId: s.broken.projectId,
      kind: 'failed',
      key: `build:${s.broken.number}`,
      snoozeKind: 'tomorrow',
      snoozedUntil: new Date('2026-03-11T09:00:00Z'),
    })
    const found = await s.search(s.owner.id, 'failed')
    expect(found?.triage.map((i) => [i.projectSlug, i.snoozed])).toEqual([
      ['secret', false],
      ['open', true],
    ])
  })

  it('finds your notifications by reason, build number and kind, with their Inbox tab', async () => {
    const s = await setup()
    for (const q of ['spacing', 'rejected', `#${s.shipped.number}`, 'mobile']) {
      // eslint-disable-next-line no-await-in-loop -- reads
      const found = await s.search(s.outsider.id, q)
      expect(found?.notifications).toMatchObject([
        {
          kind: 'build_rejected',
          tab: 'everything',
          read: false,
          payload: { reason: 'spacing is off' },
        },
      ])
    }
    expect((await s.search(s.outsider.id, 'spacing'))?.notifications[0]?.actor?.name).toBeTruthy()
    // Someone else's notifications never match.
    expect((await s.search(s.owner.id, 'spacing'))?.notifications).toEqual([])
    const snoozed = await seedNotification(t.db, {
      userId: s.owner.id,
      buildId: s.shipped.id,
      kind: 'mentioned',
      payload: { snippet: 'please recheck the totals' },
      snoozedUntil: new Date('2026-03-20T00:00:00Z'),
    })
    expect((await s.search(s.owner.id, 'totals'))?.notifications).toMatchObject([
      { id: snoozed.id, tab: 'snoozed' },
    ])
  })

  it('finds notices with no build, by the inbox rules: project access, and managers for a connection', async () => {
    const s = await setup()
    const flakyOpen = await seedNotification(t.db, {
      userId: s.outsider.id,
      kind: 'flaky_detected',
      projectId: s.first.project.id,
      payload: { name: 'checkout/summary', count: 1 },
    })
    await seedNotification(t.db, {
      userId: s.outsider.id,
      kind: 'flaky_detected',
      projectId: s.secret.id,
    })
    const connectionPayload = { reason: 'Token revoked by Slack' }
    const connection = (userId: string) =>
      seedNotification(t.db, {
        userId,
        kind: 'connection_needs_attention',
        workspaceId: s.workspace.id,
        payload: connectionPayload,
      })
    const ownersConnection = await connection(s.owner.id)
    await connection(s.outsider.id)

    const flaky = (await s.search(s.outsider.id, 'flaky'))?.notifications
    expect(flaky).toMatchObject([
      { id: flakyOpen.id, kind: 'flaky_detected', build: null, project: { slug: 'open' } },
    ])
    // The owner manages the workspace; a plain member is not told about the connection.
    expect((await s.search(s.owner.id, 'revoked'))?.notifications).toMatchObject([
      { id: ownersConnection.id, build: null, project: null },
    ])
    expect((await s.search(s.outsider.id, 'revoked'))?.notifications).toEqual([])
    // A project search narrows to that project's notices.
    const inSecret = await searchWorkspace(t.db, {
      userId: s.owner.id,
      workspaceSlug: s.workspace.slug,
      query: 'revoked',
      project: 'secret',
      now,
    })
    expect(inSecret?.notifications).toEqual([])
  })

  it('finds open review requests asked of you or by you, with their Reviews tab', async () => {
    const s = await setup()
    expect((await s.search(s.outsider.id, 'mobile'))?.reviews).toMatchObject([
      {
        id: s.request.id,
        tab: 'for-you',
        projectSlug: 'open',
        reviewer: { name: 'Olive Outsider' },
      },
    ])
    const asked = (await s.search(s.owner.id, 'olive'))?.reviews.filter(
      (r) => r.projectSlug === 'open',
    )
    expect(asked).toMatchObject([{ id: s.request.id, tab: 'created' }])
  })

  it('finds your own saved views only', async () => {
    const s = await setup()
    expect((await s.search(s.outsider.id, 'checkout'))?.views).toMatchObject([
      { id: s.view.id, name: 'Checkout reviews', project: null },
    ])
    expect((await s.search(s.owner.id, 'checkout'))?.views).toEqual([])
  })

  it('leaves a hidden project out of every group, though the person has rows about it', async () => {
    const s = await setup()
    for (const q of ['secretive', 'feed99', 'checkout/hidden', 'secret', 'view', 'approved']) {
      // eslint-disable-next-line no-await-in-loop -- reads
      const found = await s.search(s.outsider.id, q)
      expect(JSON.stringify({ ...found, query: '' })).not.toMatch(/secret|hidden|feed999/i)
    }
    // The owner is in the project and does see them.
    expect((await s.search(s.owner.id, 'secretive'))?.builds).toMatchObject([
      { projectSlug: 'secret', name: 'secretive' },
    ])
    expect((await s.search(s.owner.id, 'checkout/hidden'))?.baselines).toHaveLength(1)
    expect((await s.search(s.owner.id, 'failed'))?.triage.map((i) => i.projectSlug)).toContain(
      'secret',
    )
  })
})
