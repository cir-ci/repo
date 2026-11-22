import { createUser, createProjectWithToken } from '@circi/auth'
import { listProjectMembers } from '@circi/db/queries'
import { addTestProjectMember } from '@circi/db/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { JSON_HEADERS, sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { addMember, signIn } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, auth, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const ws = acme.workspaceSlug
const web = `/api/projects/${ws}/web`

async function person(name: string, role: 'admin' | 'member', projects: boolean) {
  const email = `${name.toLowerCase()}@acme.test`
  const password = `${name}-password-long-1`
  const user = await createUser(auth, { email, name, password })
  await addMember(auth, db, { workspaceSlug: ws, email, role, projects })
  return { id: user.id, name, email, cookie: await signIn(app, email, password) }
}

// ann is in web; bob is a member of the workspace and of no project; cy is an admin in no project.
const ann = await person('Ann', 'member', true)
const bob = await person('Bob', 'member', false)
const cy = await person('Cy', 'admin', false)

const send = sender(() => app, acmeCookie)
const reset = await fx.snapshot()
beforeEach(reset)

const ids = (res: { json(): { members: { id: string }[] } }) =>
  res
    .json()
    .members.map((m) => m.id)
    .toSorted()

describe('a project a member is not in', () => {
  const missing = `/api/projects/${ws}/nope`
  const reads = [
    '',
    '/builds/2',
    '/builds/2/activity',
    '/builds/2/comments',
    '/baselines',
    '/flaky',
    '/ignore-regions',
    '/members',
    '/rules',
    '/settings',
    '/sites',
    '/snapshots/home/history',
    '/token',
    '/triage',
  ]

  it('answers 404 on every read, exactly as for a project that does not exist', async () => {
    for (const path of reads) {
      // oxlint-disable-next-line no-await-in-loop -- readable failures
      const hidden = await get(`${web}${path}`, bob.cookie)
      // oxlint-disable-next-line no-await-in-loop -- readable failures
      const none = await get(`${missing}${path}`, bob.cookie)
      expect([path, hidden.statusCode, hidden.body]).toEqual([path, 404, none.body])
    }
  })

  it('answers 404 on every write, never a 403 that would give it away', async () => {
    const writes: [Parameters<typeof send>[0], string, unknown][] = [
      ['POST', '/builds/2/review', { state: 'approved' }],
      ['POST', '/builds/2/review-requests', { reviewerId: ann.id }],
      ['POST', '/builds/2/comments', { body: 'hi' }],
      ['POST', '/rules', { kind: 'snapshot-name', pattern: 'x', reviewerIds: [ann.id] }],
      ['PUT', '/triage-rotation', { memberIds: [ann.id] }],
      ['POST', '/triage/assign', { kind: 'flaky', key: 'home', assigneeId: ann.id }],
      ['PATCH', '/settings', { name: 'x' }],
      ['POST', '/members', { userIds: [bob.id] }],
      ['DELETE', `/members/${ann.id}`, undefined],
      ['POST', '/token', {}],
    ]
    for (const [method, path, payload] of writes) {
      // oxlint-disable-next-line no-await-in-loop -- readable failures
      const res = await send(method, `${web}${path}`, { cookie: bob.cookie, payload })
      expect([method, path, res.statusCode]).toEqual([method, path, 404])
    }
  })

  it('is missing from the sidebar, the project list and search, and shows up for its members and admins', async () => {
    const slugs = async (cookie: string) =>
      (await get(`/api/workspaces/${ws}/sidebar`, cookie))
        .json()
        .projects.map((x: { slug: string }) => x.slug)
    expect(await slugs(bob.cookie)).toEqual([])
    expect(await slugs(ann.cookie)).toEqual(['web'])
    expect(await slugs(cy.cookie)).toEqual(['web'])
    expect((await get('/api/projects', bob.cookie)).json().projects).toEqual([])
    const found = async (cookie: string) =>
      (await get(`/api/workspaces/${ws}/search?q=web`, cookie)).json().projects
    expect(await found(bob.cookie)).toEqual([])
    expect(await found(ann.cookie)).toHaveLength(1)
    // The workspace's own build list is the same story.
    expect((await get(`/api/workspaces/${ws}/builds`, bob.cookie)).json().builds).toEqual([])
    expect(
      (await get(`/api/workspaces/${ws}/builds`, ann.cookie)).json().builds.length,
    ).toBeGreaterThan(0)
  })

  it('does not let a stranger from another workspace pick up any of it', async () => {
    expect((await get(`${web}/members`, rivalCookie)).statusCode).toBe(404)
  })
})

describe('GET members', () => {
  it('lists the project by name for its members and for owners and admins, with canManage', async () => {
    const asAnn = await get(`${web}/members`, ann.cookie)
    expect(asAnn.statusCode).toBe(200)
    expect(asAnn.json().canManage).toBe(false)
    expect(asAnn.json().members.map((m: { name: string }) => m.name)).toEqual(
      asAnn
        .json()
        .members.map((m: { name: string }) => m.name)
        .toSorted(),
    )
    expect(asAnn.json().members.find((m: { id: string }) => m.id === ann.id)).toMatchObject({
      name: 'Ann',
      email: ann.email,
      image: null,
      role: 'member',
      addedAt: expect.any(String),
    })
    expect(ids(asAnn)).toEqual([acme.owner.id, ann.id].toSorted())
    const asAdmin = await get(`${web}/members`, cy.cookie)
    expect(asAdmin.json().canManage).toBe(true)
    expect(ids(asAdmin)).toEqual(ids(asAnn))
  })
})

describe('POST members', () => {
  it('lets an owner or admin add workspace members, adding someone already in as a no-op', async () => {
    const added = await send('POST', `${web}/members`, { payload: { userIds: [bob.id, ann.id] } })
    expect(added.statusCode).toBe(200)
    expect(ids(added)).toEqual([acme.owner.id, ann.id, bob.id].toSorted())
    expect(added.json().canManage).toBe(true)
    // Bob sees the project now.
    expect((await get(web, bob.cookie)).statusCode).toBe(200)
    const byAdmin = await send('POST', `${web}/members`, {
      cookie: cy.cookie,
      payload: { userIds: [cy.id] },
    })
    expect(ids(byAdmin)).toContain(cy.id)
  })

  it('refuses a member of the project (403) and anyone who is not in the workspace (400)', async () => {
    const byMember = await send('POST', `${web}/members`, {
      cookie: ann.cookie,
      payload: { userIds: [bob.id] },
    })
    expect(byMember.statusCode).toBe(403)
    expect(ids(await get(`${web}/members`))).not.toContain(bob.id)

    const stranger = await fxStranger()
    const bad = await send('POST', `${web}/members`, { payload: { userIds: [bob.id, stranger] } })
    expect(bad.statusCode).toBe(400)
    expect(ids(await get(`${web}/members`))).not.toContain(bob.id)
  })

  it('refuses a malformed body', async () => {
    expect((await send('POST', `${web}/members`, { payload: { userIds: 'bob' } })).statusCode).toBe(
      400,
    )
    expect((await send('POST', `${web}/members`, { payload: {} })).statusCode).toBe(400)
  })
})

async function fxStranger(): Promise<string> {
  const user = await createUser(auth, {
    email: `stranger-${Math.random().toString(36).slice(2)}@elsewhere.test`,
    name: 'Stranger',
    password: 'stranger-password-long-1',
  })
  return user.id
}

describe('DELETE members/:userId', () => {
  it('lets owners and admins remove anyone, and answers 204', async () => {
    const res = await send('DELETE', `${web}/members/${ann.id}`)
    expect(res.statusCode).toBe(204)
    expect((await get(web, ann.cookie)).statusCode).toBe(404)
    const byAdmin = await send('DELETE', `${web}/members/${acme.owner.id}`, { cookie: cy.cookie })
    expect(byAdmin.statusCode).toBe(204)
    // The last member can go too; the project stays for owners and admins.
    expect(await listProjectMembers(db, acme.project.id)).toEqual([])
    expect((await get(web, cy.cookie)).statusCode).toBe(200)
  })

  it('lets a member leave, but not remove someone else', async () => {
    const other = await send('DELETE', `${web}/members/${acme.owner.id}`, { cookie: ann.cookie })
    expect(other.statusCode).toBe(403)
    const leave = await send('DELETE', `${web}/members/${ann.id}`, { cookie: ann.cookie })
    expect(leave.statusCode).toBe(204)
    expect((await get(web, ann.cookie)).statusCode).toBe(404)
  })

  it('takes the person off the rules and the rotation too, and leaves what happened', async () => {
    await send('POST', `${web}/members`, { payload: { userIds: [bob.id] } })
    const rule = await send('POST', `${web}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'a/**', reviewerIds: [bob.id, acme.owner.id] },
    })
    expect(rule.statusCode).toBe(201)
    expect(
      (
        await send('PUT', `${web}/triage-rotation`, {
          payload: { memberIds: [bob.id, acme.owner.id] },
        })
      ).statusCode,
    ).toBe(200)

    expect(
      (await send('DELETE', `${web}/members/${bob.id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(204)

    const rules = (await get(`${web}/rules`)).json()
    expect(rules.rules[0].reviewers.map((r: { id: string }) => r.id)).toEqual([acme.owner.id])
    expect(rules.rotation.members.map((m: { id: string }) => m.id)).toEqual([acme.owner.id])
  })
})

const inbox = async (cookie: string) =>
  (await get('/api/inbox', cookie)).json().items.map((i: { kind: string }) => i.kind)

describe('who can be picked', () => {
  it('accepts only members of the project for rules, the rotation, assignments and review requests', async () => {
    const rule = await send('POST', `${web}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'a', reviewerIds: [bob.id] },
    })
    expect(rule.statusCode).toBe(400)
    expect(rule.json().error).toMatch(/members of this project/)
    expect(
      (await send('PUT', `${web}/triage-rotation`, { payload: { memberIds: [bob.id] } }))
        .statusCode,
    ).toBe(400)
    expect(
      (
        await send('POST', `${web}/triage/assign`, {
          payload: { kind: 'flaky', key: 'home', assigneeId: bob.id },
        })
      ).statusCode,
    ).toBe(400)
    const request = await send('POST', `${web}/builds/2/review-requests`, {
      payload: { reviewerId: bob.id },
    })
    expect(request.statusCode).toBe(400)
    expect(request.json().error).toMatch(/must be a member of this project/)
    const ok = await send('POST', `${web}/builds/2/review-requests`, {
      payload: { reviewerId: ann.id },
    })
    expect(ok.statusCode).toBe(201)
  })

  it('notifies only project members of an @mention', async () => {
    // Bob is not in the project: his name in a comment reaches nobody.
    const res = await send('POST', `${web}/builds/2/comments`, {
      payload: { body: '@Bob and @Ann look' },
    })
    expect(res.statusCode).toBe(201)
    expect(await inbox(bob.cookie)).not.toContain('mentioned')
    expect(await inbox(ann.cookie)).toContain('mentioned')
  })
})

const create = (payload: unknown, cookie = acmeCookie) =>
  send('POST', `/api/workspaces/${ws}/projects`, { cookie, payload })

describe('creating a project', () => {
  it('adds the creator and the members named, and the project is theirs to see', async () => {
    const res = await create({ name: 'Docs', memberIds: [bob.id] })
    expect(res.statusCode).toBe(201)
    expect(ids(await get(`/api/projects/${ws}/docs/members`))).toEqual(
      [acme.owner.id, bob.id].toSorted(),
    )
    expect((await get(`/api/projects/${ws}/docs`, bob.cookie)).statusCode).toBe(200)
    expect((await get(`/api/projects/${ws}/docs`, ann.cookie)).statusCode).toBe(404)
  })

  it('starts with just the creator when no members are named', async () => {
    expect((await create({ name: 'Alone' })).statusCode).toBe(201)
    expect(ids(await get(`/api/projects/${ws}/alone/members`))).toEqual([acme.owner.id])
  })

  it('refuses people from outside the workspace and creates nothing', async () => {
    const res = await create({ name: 'Nope', memberIds: [await fxStranger()] })
    expect(res.statusCode).toBe(400)
    expect((await get(`/api/projects/${ws}/nope`)).statusCode).toBe(404)
    expect((await create({ name: 'Nope', memberIds: [rival.owner.id] })).statusCode).toBe(400)
  })
})

describe('leaving the workspace', () => {
  it('takes a removed member out of all its projects, their rules and the rotation', async () => {
    const second = await createProjectWithToken(auth, db, {
      workspaceSlug: ws,
      name: 'second',
      memberIds: [ann.id],
    })
    await send('POST', `${web}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'a', reviewerIds: [ann.id] },
    })
    await send('PUT', `${web}/triage-rotation`, { payload: { memberIds: [ann.id] } })

    const org = await app.inject({
      method: 'GET',
      url: `/api/auth/organization/get-full-organization?organizationSlug=${ws}`,
      headers: { cookie: acmeCookie },
    })
    const body: { id: string; members: { id: string; user: { email: string } }[] } = org.json()
    const seat = body.members.find((m) => m.user.email === ann.email)
    const removed = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/remove-member',
      headers: { ...JSON_HEADERS, cookie: acmeCookie },
      payload: { memberIdOrEmail: seat?.id, organizationId: body.id },
    })
    expect(removed.statusCode).toBe(200)

    expect((await listProjectMembers(db, acme.project.id)).map((m) => m.id)).not.toContain(ann.id)
    expect((await listProjectMembers(db, second.project.id)).map((m) => m.id)).not.toContain(ann.id)
    const rules = (await get(`${web}/rules`)).json()
    expect(rules.rules[0].reviewers).toEqual([])
    expect(rules.rotation.members).toEqual([])
    // Added back to the workspace later, Ann is in no project until someone adds her.
    await addMember(auth, db, {
      workspaceSlug: ws,
      email: ann.email,
      role: 'member',
      projects: false,
    })
    expect((await get(web, ann.cookie)).statusCode).toBe(404)
    await addTestProjectMember(db, { projectId: acme.project.id, userId: ann.id })
    expect((await get(web, ann.cookie)).statusCode).toBe(200)
  })
})

describe('the Members page', () => {
  it('shows each person the projects the viewer may see', async () => {
    const asOwner = (await get(`/api/workspaces/${ws}/member-projects`)).json().projects
    expect(asOwner[ann.id].map((x: { slug: string }) => x.slug)).toEqual(['web'])
    expect(asOwner[bob.id]).toBeUndefined()
    expect(asOwner[acme.owner.id][0]).toMatchObject({ slug: 'web', name: 'web', icon: null })
    // Bob is in no project, so he sees nobody's projects.
    expect((await get(`/api/workspaces/${ws}/member-projects`, bob.cookie)).json()).toEqual({
      projects: {},
    })
    expect((await get(`/api/workspaces/${ws}/member-projects`, rivalCookie)).statusCode).toBe(404)
  })
})
