import { NotFoundError, ValidationError } from '@circi/core'
import { getTriageRotation, listReviewRules } from '@circi/db/queries'
import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addReviewRule,
  editReviewRule,
  orderReviewRules,
  removeReviewRule,
  replaceTriageRotation,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { team, workspace } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id })
  return { team, ann }
}

describe('review rules', () => {
  it('adds, edits, orders and removes rules', async () => {
    const { team, ann } = await setup()
    const a = await addReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'Button*',
      reviewerIds: [ann.id],
    })
    const b = await addReviewRule(t.db, {
      teamId: team.id,
      kind: 'build-name',
      pattern: 'web',
      reviewerIds: [ann.id],
    })
    const edited = await editReviewRule(t.db, {
      teamId: team.id,
      id: b.id,
      kind: 'build-name',
      pattern: 'web-*',
      reviewerIds: [ann.id],
    })
    expect(edited.pattern).toBe('web-*')
    const ordered = await orderReviewRules(t.db, team.id, [b.id, a.id])
    expect(ordered.map((r) => r.id)).toEqual([b.id, a.id])
    await removeReviewRule(t.db, team.id, a.id)
    expect((await listReviewRules(t.db, team.id)).map((r) => r.id)).toEqual([b.id])
    await expect(removeReviewRule(t.db, team.id, a.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses a reviewer outside the workspace and leaves nothing behind', async () => {
    const { team } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addReviewRule(t.db, {
        teamId: team.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [stranger.id],
      }),
    ).rejects.toThrow(ValidationError)
    expect(await listReviewRules(t.db, team.id)).toEqual([])
  })
})

describe('replaceTriageRotation', () => {
  it('sets the rotation and an empty list turns it off', async () => {
    const { team, ann } = await setup()
    const on = await replaceTriageRotation(t.db, { teamId: team.id, memberIds: [ann.id] })
    expect(on.startsOn).not.toBeNull()
    const off = await replaceTriageRotation(t.db, { teamId: team.id, memberIds: [] })
    expect(off.startsOn).toBeNull()
    expect((await getTriageRotation(t.db, team.id)).members).toEqual([])
  })
})
