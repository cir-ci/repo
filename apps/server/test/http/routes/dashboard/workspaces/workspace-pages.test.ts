import { teamColorFor } from '@circi/core'
import { seedBuild, seedScreenshot, seedSite } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { caller } from '#test/support/client.ts'
import { startPages } from '#test/support/pages-fixture.ts'

/** The workspace page endpoints: rename, address, retention, storage usage. */

const fx = await startPages()
const { app, t, acme, rival, ownerCookie, memberCookie, rivalCookie } = fx
afterAll(() => fx.close())
const reset = await fx.snapshot()
beforeEach(reset)

const team = () => `/api/teams/${acme.workspaceSlug}/web`
const workspace = () => `/api/workspaces/${acme.workspaceSlug}`
const call = caller(() => app)

describe('workspace name, address and default retention', () => {
  it('shows the name and address to members and lets owners rename', async () => {
    const got = (await call('GET', workspace(), memberCookie)).json()
    expect(got).toEqual({
      canManage: false,
      isOwner: false,
      name: expect.any(String),
      slug: acme.workspaceSlug,
      picture: null,
    })
    const res = await call('PATCH', workspace(), ownerCookie, { name: 'Acme Inc' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ name: 'Acme Inc', slug: acme.workspaceSlug })
    expect((await call('GET', workspace(), ownerCookie)).json().name).toBe('Acme Inc')
  })

  it('refuses members (403), outsiders (404), bad and taken addresses, then moves the address', async () => {
    expect((await call('PATCH', workspace(), memberCookie, { name: 'x' })).statusCode).toBe(403)
    expect((await call('PATCH', workspace(), rivalCookie, { name: 'x' })).statusCode).toBe(404)
    expect((await call('GET', workspace(), rivalCookie)).statusCode).toBe(404)
    expect((await call('PATCH', workspace(), ownerCookie, { name: '' })).statusCode).toBe(400)
    expect((await call('PATCH', workspace(), ownerCookie, { slug: 'api' })).statusCode).toBe(400)
    expect((await call('PATCH', workspace(), ownerCookie, { slug: 'No Good' })).statusCode).toBe(
      400,
    )
    expect((await call('PATCH', workspace(), ownerCookie, { bogus: 1 })).statusCode).toBe(400)
    const taken = await call('PATCH', workspace(), ownerCookie, { slug: rival.workspaceSlug })
    expect(taken.statusCode).toBe(409)

    const oldBase = workspace()
    const moved = await call('PATCH', oldBase, ownerCookie, { slug: `${acme.workspaceSlug}-two` })
    expect(moved.json().slug).toBe(`${acme.workspaceSlug}-two`)
    expect((await call('GET', oldBase, ownerCookie)).statusCode).toBe(404)
    // Put it back so the other tests keep their address.
    const back = await call('PATCH', `${oldBase}-two`, ownerCookie, { slug: acme.workspaceSlug })
    expect(back.statusCode).toBe(200)
  })

  it('saves the default retention for new teams and leaves existing teams alone', async () => {
    const url = `${workspace()}/settings`
    expect((await call('PATCH', url, ownerCookie, { retentionDays: 90 })).json().settings).toEqual({
      flakyBlocksMerge: true,
      assignTriageToOnCall: false,
      retentionDays: 90,
    })
    expect((await call('PATCH', url, ownerCookie, { retentionDays: 0 })).statusCode).toBe(400)
    expect((await call('PATCH', url, memberCookie, { retentionDays: 5 })).statusCode).toBe(403)
    expect((await call('PATCH', url, rivalCookie, { retentionDays: 5 })).statusCode).toBe(404)
    const existing = (await call('GET', `${team()}/settings`, ownerCookie)).json()
    expect(existing.settings.retentionDays).toBe(30)
    expect(existing.workspace.retentionDays).toBe(90)
    await call('POST', `${workspace()}/teams`, ownerCookie, { name: 'Late team' })
    const late = (
      await call('GET', `${team().replace('/web', '/late-team')}/settings`, ownerCookie)
    ).json()
    expect(late.settings.retentionDays).toBe(90)
  })
})

describe('merge gate defaults', () => {
  it('lists each team with its own flaky setting, null when it follows the default', async () => {
    const res = await call('GET', `${workspace()}/settings`, memberCookie)
    expect(res.statusCode).toBe(200)
    const { teams } = res.json()
    expect(teams.find((p: { slug: string }) => p.slug === 'web')).toEqual({
      slug: 'web',
      name: expect.any(String),
      flakyBlocksMerge: null,
      assignTriageToOnCall: null,
    })
    await call('PATCH', `${team()}/settings`, ownerCookie, { flakyBlocksMerge: false })
    const after = (await call('GET', `${workspace()}/settings`, memberCookie)).json()
    expect(after.teams.find((p: { slug: string }) => p.slug === 'web').flakyBlocksMerge).toBe(false)
    await call('PATCH', `${team()}/settings`, ownerCookie, { flakyBlocksMerge: null })
  })
})

describe('triage assignment default', () => {
  it('is off, changes for owners and admins only, and shows each team that overrides it', async () => {
    const url = `${workspace()}/settings`
    expect((await call('GET', url, memberCookie)).json().settings.assignTriageToOnCall).toBe(false)
    const on = await call('PATCH', url, ownerCookie, { assignTriageToOnCall: true })
    expect(on.json().settings.assignTriageToOnCall).toBe(true)
    expect(
      (await call('PATCH', url, ownerCookie, { assignTriageToOnCall: 'yes' })).statusCode,
    ).toBe(400)
    expect(
      (await call('PATCH', url, memberCookie, { assignTriageToOnCall: false })).statusCode,
    ).toBe(403)
    expect(
      (await call('PATCH', url, rivalCookie, { assignTriageToOnCall: false })).statusCode,
    ).toBe(404)
    await call('PATCH', `${team()}/settings`, ownerCookie, { assignTriageToOnCall: false })
    const after = (await call('GET', url, memberCookie)).json()
    expect(after.settings.assignTriageToOnCall).toBe(true)
    expect(after.teams.find((p: { slug: string }) => p.slug === 'web').assignTriageToOnCall).toBe(
      false,
    )
    await call('PATCH', `${team()}/settings`, ownerCookie, { assignTriageToOnCall: null })
    await call('PATCH', url, ownerCookie, { assignTriageToOnCall: false })
  })
})

describe('storage usage', () => {
  it('reports bytes by kind and by team with the retention settings, to members only', async () => {
    expect(
      (await call('PATCH', `${workspace()}/settings`, ownerCookie, { retentionDays: 90 }))
        .statusCode,
    ).toBe(200)
    const build = await seedBuild(t.db, acme.team.id)
    await seedScreenshot(t.db, {
      buildId: build.id,
      fileSha256: fakeSha('a'),
      size: 1000,
      thumbnailSha256: fakeSha('b'),
      thumbnailSize: 100,
    })
    await seedSite(t.db, {
      teamId: acme.team.id,
      files: [{ path: 'index.html', sha256: fakeSha('c'), size: 500 }],
    })
    const res = await call('GET', `${workspace()}/storage`, memberCookie)
    expect(res.statusCode).toBe(200)
    const usage = res.json()
    expect(usage).toMatchObject({ canManage: false, totalBytes: 1600, totalFiles: 3 })
    expect(usage.kinds).toEqual([
      { kind: 'screenshot', files: 1, bytes: 1000 },
      { kind: 'diff', files: 0, bytes: 0 },
      { kind: 'thumbnail', files: 1, bytes: 100 },
      { kind: 'site', files: 1, bytes: 500, versions: 1 },
    ])
    const web = usage.teams.find((p: { slug: string }) => p.slug === 'web')
    expect(web).toMatchObject({
      bytes: 1600,
      files: 3,
      retentionDays: 30,
      color: teamColorFor('web'),
    })
    expect(usage.defaultRetentionDays).toBe(90)

    // Outsiders get 404 and see none of it.
    expect((await call('GET', `${workspace()}/storage`, rivalCookie)).statusCode).toBe(404)
    const own = (
      await call('GET', `/api/workspaces/${rival.workspaceSlug}/storage`, rivalCookie)
    ).json()
    expect(own.totalBytes).toBe(0)
  })
})
