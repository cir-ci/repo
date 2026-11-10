import { createWorkspace } from '@circi/auth'
import * as schema from '@circi/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { signIn } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, db, auth, acme, rival, acmeCookie, client } = fx
afterAll(() => fx.close())

const lastWorkspace = async (cookie: string = acmeCookie) =>
  (await client.as(cookie).get('/api/capabilities')).json<{ lastWorkspace: string | null }>()
    .lastWorkspace
const open = (slug: string, cookie: string = acmeCookie) =>
  client.as(cookie).send('PUT', `/api/workspaces/${slug}/last-opened`)
const readRow = () =>
  db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, acme.owner.id))

describe('the workspace a person opened last', () => {
  it('is null until they open one, then follows them to every device', async () => {
    expect(await lastWorkspace()).toBeNull()
    expect((await open(acme.workspaceSlug)).statusCode).toBe(204)
    expect(await lastWorkspace()).toBe(acme.workspaceSlug)
    // A second sign-in (another device) reads the same value from the account.
    const other = await signIn(app, acme.owner.email, acme.owner.password)
    expect(await lastWorkspace(other)).toBe(acme.workspaceSlug)
  })

  it('writes only on change: opening the remembered workspace again leaves the row alone', async () => {
    await open(acme.workspaceSlug)
    const [before] = await readRow()
    await open(acme.workspaceSlug)
    const [after] = await readRow()
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
  })

  it("refuses a workspace the person can't open, and keeps the old value", async () => {
    await open(acme.workspaceSlug)
    expect((await open(rival.workspaceSlug)).statusCode).toBe(404)
    expect((await open('no-such-workspace')).statusCode).toBe(404)
    const anonymous = await client.anonymous.send(
      'PUT',
      `/api/workspaces/${acme.workspaceSlug}/last-opened`,
    )
    expect(anonymous.statusCode).toBe(401)
    expect(await lastWorkspace()).toBe(acme.workspaceSlug)
  })

  it('stops naming a workspace that was deleted', async () => {
    const second = await createWorkspace(auth, db, {
      name: 'Second',
      slug: 'second-space',
      ownerEmail: acme.owner.email,
    })
    expect((await open(second.slug)).statusCode).toBe(204)
    expect(await lastWorkspace()).toBe('second-space')
    const deleted = await client.as(acmeCookie).send('DELETE', '/api/workspaces/second-space', {
      confirm: 'second-space',
    })
    expect(deleted.statusCode).toBe(200)
    expect(await lastWorkspace()).toBeNull()
  })
})
