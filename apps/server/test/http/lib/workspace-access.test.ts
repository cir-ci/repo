import { afterAll, describe, expect, it } from 'vitest'

import { startAccess } from '#test/support/access-fixture.ts'

const fx = await startAccess()
const { acme, people } = fx
afterAll(() => fx.close())

const workspace = `/workspace/${acme.workspaceSlug}`

describe('loadWorkspace', () => {
  it('lets every member through, whatever the role', async () => {
    const all = await Promise.all(
      [people.acmeOwner, people.admin, people.member].map((user) => fx.get(workspace, user)),
    )
    expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200])
    for (const res of all) expect(res.json()).toEqual({ ok: true, workspace: acme.workspaceSlug })
  })

  it('answers someone who is not a member exactly as for a workspace that does not exist', async () => {
    const madeUp = await fx.get('/workspace/nope', people.outsider)
    expect(madeUp.statusCode).toBe(404)
    const outside = await Promise.all(
      [people.outsider, people.rivalOwner].map((user) => fx.get(workspace, user)),
    )
    for (const res of outside) {
      expect(res.statusCode).toBe(404)
      expect(res.body).toBe(madeUp.body)
    }
  })

  it('does not admit a session scoped to another workspace', async () => {
    const res = await fx.get(workspace, people.acmeOwner, { scopedTo: 'some-other-workspace-id' })
    expect(res.statusCode).toBe(404)
  })
})
