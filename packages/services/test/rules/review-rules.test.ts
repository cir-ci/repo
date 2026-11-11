import { NotFoundError, ValidationError } from '@circi/core'
import { getTriageRotation, listReviewRules } from '@circi/db/queries'
import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/db/testing'
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
  const { project, workspace } = await seedProject(t.db)
  const ann = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id })
  return { project, ann }
}

describe('review rules', () => {
  it('adds, edits, orders and removes rules', async () => {
    const { project, ann } = await setup()
    const a = await addReviewRule(t.db, {
      projectId: project.id,
      kind: 'snapshot-name',
      pattern: 'Button*',
      reviewerIds: [ann.id],
    })
    const b = await addReviewRule(t.db, {
      projectId: project.id,
      kind: 'build-name',
      pattern: 'web',
      reviewerIds: [ann.id],
    })
    const edited = await editReviewRule(t.db, {
      projectId: project.id,
      id: b.id,
      kind: 'build-name',
      pattern: 'web-*',
      reviewerIds: [ann.id],
    })
    expect(edited.pattern).toBe('web-*')
    const ordered = await orderReviewRules(t.db, project.id, [b.id, a.id])
    expect(ordered.map((r) => r.id)).toEqual([b.id, a.id])
    await removeReviewRule(t.db, project.id, a.id)
    expect((await listReviewRules(t.db, project.id)).map((r) => r.id)).toEqual([b.id])
    await expect(removeReviewRule(t.db, project.id, a.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses a reviewer outside the workspace and leaves nothing behind', async () => {
    const { project } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      addReviewRule(t.db, {
        projectId: project.id,
        kind: 'snapshot-name',
        pattern: 'x',
        reviewerIds: [stranger.id],
      }),
    ).rejects.toThrow(ValidationError)
    expect(await listReviewRules(t.db, project.id)).toEqual([])
  })
})

describe('replaceTriageRotation', () => {
  it('sets the rotation and an empty list turns it off', async () => {
    const { project, ann } = await setup()
    const on = await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [ann.id] })
    expect(on.startsOn).not.toBeNull()
    const off = await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [] })
    expect(off.startsOn).toBeNull()
    expect((await getTriageRotation(t.db, project.id)).members).toEqual([])
  })
})
