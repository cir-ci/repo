import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTriageRotation, listReviewRules } from '#src/queries/index.ts'
import {
  createReviewRule,
  deleteReviewRule,
  listRulesForResolution,
  reorderReviewRules,
  setTriageRotation,
  updateReviewRule,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
  const stranger = await seedUser(t.db)
  return { team, owner, mate, stranger }
}

const ids = (rules: { id: string }[]) => rules.map((r) => r.id)

describe('review rules', () => {
  it('lists rules in creation order with their reviewers', async () => {
    const { team, owner, mate } = await setup()
    const a = await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: '  checkout/** ',
      reviewerIds: [mate.id, mate.id],
    })
    const b = await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'build-name',
      pattern: 'mobile-*',
      reviewerIds: [owner.id],
    })
    expect(a).toMatchObject({ pattern: 'checkout/**', position: 0 })
    expect(a.reviewers).toEqual([{ id: mate.id, name: mate.name }])
    expect(b.position).toBe(1)
    expect((await listReviewRules(t.db, team.id)).map((r) => r.id)).toEqual([a.id, b.id])
  })

  it('refuses a blank pattern, no reviewers, an unknown kind and non-members', async () => {
    const { team, mate, stranger } = await setup()
    const ok = {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'x',
      reviewerIds: [mate.id],
    }
    await expect(createReviewRule(t.db, { ...ok, pattern: '  ' })).rejects.toThrow(/pattern/)
    await expect(createReviewRule(t.db, { ...ok, reviewerIds: [] })).rejects.toThrow(/reviewer/)
    await expect(createReviewRule(t.db, { ...ok, kind: 'regex' })).rejects.toThrow(/kind/)
    await expect(createReviewRule(t.db, { ...ok, reviewerIds: [stranger.id] })).rejects.toThrow(
      /members/,
    )
    expect(await listReviewRules(t.db, team.id)).toEqual([])
  })

  it('updates and deletes a rule of the team only', async () => {
    const { team, owner, mate } = await setup()
    const other = await seedTeam(t.db)
    const rule = await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'a',
      reviewerIds: [mate.id],
    })
    const updated = await updateReviewRule(t.db, {
      id: rule.id,
      teamId: team.id,
      kind: 'build-name',
      pattern: 'b',
      reviewerIds: [owner.id],
    })
    expect(updated).toMatchObject({ kind: 'build-name', pattern: 'b', position: 0 })
    expect(updated.reviewers.map((r) => r.id)).toEqual([owner.id])
    await expect(deleteReviewRule(t.db, other.team.id, rule.id)).rejects.toThrow(/not found/)
    await deleteReviewRule(t.db, team.id, rule.id)
    expect(await listReviewRules(t.db, team.id)).toEqual([])
  })

  it('reorders rules, and refuses a list that is not every rule once', async () => {
    const { team, owner } = await setup()
    const make = (pattern: string) =>
      createReviewRule(t.db, {
        teamId: team.id,
        kind: 'snapshot-name',
        pattern,
        reviewerIds: [owner.id],
      })
    const [a, b, c] = [await make('a'), await make('b'), await make('c')]
    const moved = await reorderReviewRules(t.db, team.id, [c.id, a.id, b.id])
    expect(ids(moved)).toEqual([c.id, a.id, b.id])
    expect(moved.map((r) => r.position)).toEqual([0, 1, 2])
    expect(ids(await listReviewRules(t.db, team.id))).toEqual([c.id, a.id, b.id])
    // A new rule goes last.
    const d = await make('d')
    expect(ids(await listReviewRules(t.db, team.id))).toEqual([c.id, a.id, b.id, d.id])
    const bad = [
      [a.id, b.id],
      [a.id, a.id, b.id, c.id],
      [a.id, b.id, c.id, owner.id],
    ]
    await Promise.all(
      bad.map((list) =>
        expect(reorderReviewRules(t.db, team.id, list)).rejects.toThrow(/exactly once/),
      ),
    )
    expect(ids(await listReviewRules(t.db, team.id))).toEqual([c.id, a.id, b.id, d.id])
  })

  it('leaves out reviewers who have left when resolving', async () => {
    const { team, owner, mate } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'a',
      reviewerIds: [owner.id, mate.id],
    })
    await t.db.delete(schema.member).where(eq(schema.member.userId, mate.id))
    expect((await listRulesForResolution(t.db, team.id))[0]?.reviewers).toEqual([owner.id])
  })
})

describe('triage rotation', () => {
  it('stores members in order, and an empty list switches it off', async () => {
    const { team, owner, mate, stranger } = await setup()
    expect(await getTriageRotation(t.db, team.id)).toEqual({ startsOn: null, members: [] })
    const startsOn = new Date('2026-03-09T00:00:00Z')
    const rotation = await setTriageRotation(t.db, {
      teamId: team.id,
      memberIds: [mate.id, owner.id],
      startsOn,
    })
    expect(rotation.members.map((m) => m.id)).toEqual([mate.id, owner.id])
    expect(rotation.startsOn).toEqual(startsOn)
    await expect(
      setTriageRotation(t.db, { teamId: team.id, memberIds: [stranger.id] }),
    ).rejects.toThrow(/member/)
    expect(await setTriageRotation(t.db, { teamId: team.id, memberIds: [] })).toEqual({
      startsOn: null,
      members: [],
    })
  })
})
