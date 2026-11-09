import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedTeam,
  seedUser,
  seedChangedSnapshots,
} from '@circi/db/testing'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { addComment, deleteComment, editComment, matchMentions, reviewBuild } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const mentions = (userId: string) =>
  t.db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, 'mentioned')))
    .orderBy(asc(schema.notifications.createdAt))

const handle = (u: { email: string }) => u.email.split('@')[0] ?? ''

/** Handles are the email's local part: `ann@…` is `@ann`. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db, `ann${Math.random().toString(36).slice(2, 8)}@example.com`)
  const bob = await seedUser(t.db, `bob${Math.random().toString(36).slice(2, 8)}@example.com`)
  const outsider = await seedUser(t.db, `zed${Math.random().toString(36).slice(2, 8)}@example.com`)
  for (const u of [ann, bob]) {
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id })
  }
  const build = await createBuild(t.db, { teamId: team.id, commitSha: 'abc1234' })
  return { team, workspace, owner, ann, bob, outsider, build }
}

describe('addComment mentions', () => {
  it('notifies a mentioned member with the comment and who wrote it', async () => {
    const { owner, ann, build } = await setup()
    const comment = await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: `@${handle(ann)} the header moved`,
    })
    const [notice, ...rest] = await mentions(ann.id)
    expect(rest).toEqual([])
    expect(notice).toMatchObject({
      buildId: build.id,
      actorId: owner.id,
      payload: { commentId: comment.id, snippet: `@${handle(ann)} the header moved` },
    })
  })

  it('does not notify the author for mentioning themselves', async () => {
    const { ann, bob, build } = await setup()
    await addComment(t.db, {
      buildId: build.id,
      authorId: ann.id,
      body: `@${handle(ann)} note to self, and @${handle(bob)}`,
    })
    expect(await mentions(ann.id)).toEqual([])
    expect(await mentions(bob.id)).toHaveLength(1)
  })

  it('ignores people outside the workspace, emails and unknown names', async () => {
    const { owner, outsider, build } = await setup()
    await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: `@${handle(outsider)} @nobody-here and mail ${outsider.email}`,
    })
    expect(await mentions(outsider.id)).toEqual([])
  })

  it('notifies a member once however often they are mentioned', async () => {
    const { owner, bob, build } = await setup()
    await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: `@${handle(bob).toUpperCase()} and @${handle(bob)}`,
    })
    expect(await mentions(bob.id)).toHaveLength(1)
  })

  it('leaves no comment and no notice when the transaction rolls back', async () => {
    const { owner, bob, build } = await setup()
    await expect(
      t.db.transaction(async (tx) => {
        await addComment(tx, { buildId: build.id, authorId: owner.id, body: `@${handle(bob)}` })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await mentions(bob.id)).toEqual([])
    const rows = await t.db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.buildId, build.id))
    expect(rows).toEqual([])
  })

  it('only notifies people newly mentioned by an edit', async () => {
    const { owner, ann, bob, build } = await setup()
    const c = await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: `@${handle(ann)} look`,
    })
    await editComment(t.db, {
      buildId: build.id,
      commentId: c.id,
      userId: owner.id,
      body: `@${handle(ann)} look, @${handle(bob)} too`,
    })
    expect(await mentions(ann.id)).toHaveLength(1)
    expect(await mentions(bob.id)).toHaveLength(1)
  })
})

describe('matchMentions', () => {
  const members = [
    { userId: 'a', name: 'Ann Lee', email: 'alee@x.io' },
    { userId: 'b', name: 'Ann Lee', email: 'other@x.io' },
    { userId: 'c', name: 'Cy Doe', email: 'cy@x.io' },
  ]
  it('matches email handles and name spellings, case-insensitively', () => {
    expect(matchMentions(['cy', 'cy-doe', 'cy.doe', 'cydoe'], members)).toEqual(['c'])
    expect(matchMentions(['alee'], members)).toEqual(['a'])
  })
  it('matches nobody for a token that fits two members', () => {
    expect(matchMentions(['ann-lee'], members)).toEqual([])
  })
})

describe('comment structure and permissions', () => {
  it('stores a region comment and a reply that inherits the snapshot', async () => {
    const { owner, build } = await setup()
    const top = await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'here',
      snapshotName: 'home',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(top.regionSide).toBe('current')
    const onBaseline = await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'was here',
      snapshotName: 'home',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      regionSide: 'baseline',
    })
    expect(onBaseline.regionSide).toBe('baseline')
    const reply = await addComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'agreed',
      parentId: top.id,
    })
    expect(reply).toMatchObject({ parentId: top.id, snapshotName: 'home', regionX: null })
    await expect(
      addComment(t.db, { buildId: build.id, authorId: owner.id, body: 'x', parentId: reply.id }),
    ).rejects.toThrow(/first comment/)
    await expect(
      addComment(t.db, {
        buildId: build.id,
        authorId: owner.id,
        body: 'x',
        region: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).rejects.toThrow(/snapshot/)
  })

  it('lets only the author edit, and the author or an admin delete', async () => {
    const { owner, ann, build } = await setup()
    const c = await addComment(t.db, { buildId: build.id, authorId: ann.id, body: 'mine' })
    const base = { buildId: build.id, commentId: c.id }
    await expect(editComment(t.db, { ...base, userId: owner.id, body: 'no' })).rejects.toThrow(
      /own comments/,
    )
    await expect(
      deleteComment(t.db, { ...base, userId: owner.id, asAdmin: false }),
    ).rejects.toThrow(/own comments/)
    await deleteComment(t.db, { ...base, userId: owner.id, asAdmin: true })
    await expect(editComment(t.db, { ...base, userId: ann.id, body: 'late' })).rejects.toThrow(
      /not found/,
    )
  })
})

describe('reject reason', () => {
  it('is stored on the review and sent to the author', async () => {
    const { team, ann, owner } = await setup()
    const build = await createBuild(t.db, {
      teamId: team.id,
      commitSha: 'def5678',
      author: { login: 'ann', userId: ann.id },
    })
    await t.db
      .update(schema.builds)
      .set({ status: 'complete', conclusion: 'changes_detected' })
      .where(eq(schema.builds.id, build.id))
    await seedChangedSnapshots(t.db, build.id)
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'logo is clipped',
    })
    const [review] = await t.db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.buildId, build.id))
    expect(review).toMatchObject({ state: 'rejected', reason: 'logo is clipped' })
    const [notice] = await t.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, ann.id),
          eq(schema.notifications.kind, 'build_rejected'),
        ),
      )
    expect(notice?.payload).toEqual({ reason: 'logo is clipped' })
  })
})
