import { getTriageRotation, listTriage } from '@circi/db/queries'
import { createTestDb, seedBuild, seedMember, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { changeProjectSettings, replaceTriageRotation } from '#src/index.ts'

// Adding, editing, ordering and removing rules are thin transactions over the repository
// functions: packages/db/test/repositories/review-rules.test.ts covers them (and the reviewer
// checks), apps/server/test/http/routes/dashboard/projects/rules.test.ts the routes.

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('replaceTriageRotation', () => {
  it('sets the rotation and an empty list turns it off', async () => {
    const { project, workspace } = await seedProject(t.db)
    const ann = await seedMember(t.db, workspace.id)
    const on = await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [ann.id] })
    expect(on.startsOn).not.toBeNull()
    const off = await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [] })
    expect(off.startsOn).toBeNull()
    expect((await getTriageRotation(t.db, project.id)).members).toEqual([])
  })

  it('hands the waiting triage items to the person it puts on triage, in the same transaction', async () => {
    const { project, workspace } = await seedProject(t.db)
    const ann = await seedMember(t.db, workspace.id)
    await seedBuild(t.db, project.id, { branch: 'main', status: 'error' })
    await changeProjectSettings(t.db, project.id, { assignTriageToOnCall: true })
    const before = await listTriage(t.db, { projectId: project.id, now: new Date() })
    expect(before.items.map((i) => i.assignee)).toEqual([null])

    await replaceTriageRotation(t.db, { projectId: project.id, memberIds: [ann.id] })
    const after = await listTriage(t.db, { projectId: project.id, now: new Date() })
    expect(after.items.map((i) => i.assignee?.id)).toEqual([ann.id])
  })
})
