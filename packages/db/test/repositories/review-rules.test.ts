import { addTestMember, createTestDb, seedProject, seedUser, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createReviewRule,
  deleteReviewRule,
  getTriageRotation,
  listReviewRules,
  listRulesForResolution,
  schema,
  setTriageRotation,
  updateReviewRule,
} from '../../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { project, org, owner } = await seedProject(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { orgId: org.id, userId: mate.id })
  const stranger = await seedUser(t.db)
  return { project, owner, mate, stranger }
}

describe('review rules', () => {
  it('lists rules in creation order with their reviewers', async () => {
    const { project, owner, mate } = await setup()
    const a = await createReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: '  checkout/** ',
      reviewerIds: [mate.id, mate.id],
    })
    const b = await createReviewRule(t.db, {
      projectId: project.id,
      kind: 'build-name',
      pattern: 'mobile-*',
      reviewerIds: [owner.id],
    })
    expect(a).toMatchObject({ pattern: 'checkout/**', position: 0 })
    expect(a.reviewers).toEqual([{ id: mate.id, name: mate.name }])
    expect(b.position).toBe(1)
    expect((await listReviewRules(t.db, project.id)).map((r) => r.id)).toEqual([a.id, b.id])
  })

  it('refuses a blank pattern, no reviewers, an unknown kind and non-members', async () => {
    const { project, mate, stranger } = await setup()
    const ok = {
      projectId: project.id,
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
    expect(await listReviewRules(t.db, project.id)).toEqual([])
  })

  it('updates and deletes a rule of the project only', async () => {
    const { project, owner, mate } = await setup()
    const other = await seedProject(t.db)
    const rule = await createReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'a',
      reviewerIds: [mate.id],
    })
    const updated = await updateReviewRule(t.db, {
      id: rule.id,
      projectId: project.id,
      kind: 'build-name',
      pattern: 'b',
      reviewerIds: [owner.id],
    })
    expect(updated).toMatchObject({ kind: 'build-name', pattern: 'b', position: 0 })
    expect(updated.reviewers.map((r) => r.id)).toEqual([owner.id])
    await expect(deleteReviewRule(t.db, other.project.id, rule.id)).rejects.toThrow(/not found/)
    await deleteReviewRule(t.db, project.id, rule.id)
    expect(await listReviewRules(t.db, project.id)).toEqual([])
  })

  it('leaves out reviewers who have left when resolving', async () => {
    const { project, owner, mate } = await setup()
    await createReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'a',
      reviewerIds: [owner.id, mate.id],
    })
    await t.db.delete(schema.member).where(eq(schema.member.userId, mate.id))
    expect((await listRulesForResolution(t.db, project.id))[0]?.reviewers).toEqual([owner.id])
  })
})

describe('triage rotation', () => {
  it('stores members in order, and an empty list switches it off', async () => {
    const { project, owner, mate, stranger } = await setup()
    expect(await getTriageRotation(t.db, project.id)).toEqual({ startsOn: null, members: [] })
    const startsOn = new Date('2026-03-09T00:00:00Z')
    const rotation = await setTriageRotation(t.db, {
      projectId: project.id,
      memberIds: [mate.id, owner.id],
      startsOn,
    })
    expect(rotation.members.map((m) => m.id)).toEqual([mate.id, owner.id])
    expect(rotation.startsOn).toEqual(startsOn)
    await expect(
      setTriageRotation(t.db, { projectId: project.id, memberIds: [stranger.id] }),
    ).rejects.toThrow(/member/)
    expect(await setTriageRotation(t.db, { projectId: project.id, memberIds: [] })).toEqual({
      startsOn: null,
      members: [],
    })
  })
})
