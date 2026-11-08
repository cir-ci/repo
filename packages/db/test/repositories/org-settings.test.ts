import { createTestDb, seedOrg } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getOrgSettings, setOrgSettings } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('org settings', () => {
  it('defaults to today’s behaviour: flaky screenshots block merges', async () => {
    const { org } = await seedOrg(t.db)
    expect(await getOrgSettings(t.db, org.id)).toEqual({ flakyBlocksMerge: true })
  })

  it('saves what was given, and keeps it across saves', async () => {
    const { org } = await seedOrg(t.db)
    expect(await setOrgSettings(t.db, org.id, { flakyBlocksMerge: false })).toEqual({
      flakyBlocksMerge: false,
    })
    expect(await getOrgSettings(t.db, org.id)).toEqual({ flakyBlocksMerge: false })
    // An empty patch changes nothing; switching back works.
    expect(await setOrgSettings(t.db, org.id, {})).toEqual({ flakyBlocksMerge: false })
    await setOrgSettings(t.db, org.id, { flakyBlocksMerge: true })
    expect(await getOrgSettings(t.db, org.id)).toEqual({ flakyBlocksMerge: true })
  })

  it('belongs to one organization', async () => {
    const a = await seedOrg(t.db)
    const b = await seedOrg(t.db)
    await setOrgSettings(t.db, a.org.id, { flakyBlocksMerge: false })
    expect(await getOrgSettings(t.db, b.org.id)).toEqual({ flakyBlocksMerge: true })
  })
})
