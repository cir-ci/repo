import { createTeamWithToken, createUser } from '@circi/auth'
import { seedBuild } from '@circi/db/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { signIn, addMember } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, auth, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

// Acme's `web` team has builds 1 and 2 (the fixture). Add a second team with its own builds,
// a member who authored some, and an unmatched git login.
const docs = (
  await createTeamWithToken(auth, db, { workspaceSlug: acme.workspaceSlug, name: 'docs' })
).team
const ada = await createUser(auth, {
  email: 'ada@acme.test',
  name: 'Ada Lovelace',
  password: 'ada-password-long-1',
})
await addMember(auth, db, { workspaceSlug: acme.workspaceSlug, email: ada.email, role: 'member' })
const adaCookie = await signIn(app, ada.email, 'ada-password-long-1')

const day = (n: number) => new Date(Date.UTC(2030, 0, n))
const done = { status: 'complete', conclusion: 'changes_detected' } as const
await seedBuild(db, docs.id, { ...done, createdAt: day(1), branch: 'main' })
await seedBuild(db, docs.id, {
  ...done,
  createdAt: day(2),
  branch: 'feature',
  author: { login: 'octocat' },
})
await seedBuild(db, docs.id, { ...done, createdAt: day(3), branch: 'main' })
const outside = await seedBuild(db, rival.team.id, { ...done, createdAt: day(4) })

const url = (query = '', workspace = acme.workspaceSlug) =>
  `/api/workspaces/${workspace}/builds${query}`
const listed = async (query = '', cookie?: string) => (await get(url(query), cookie)).json()
const ids = (body: { builds: { id: string }[] }) => body.builds.map((b) => b.id)

const reset = await fx.snapshot()
beforeEach(reset)

describe('GET /api/workspaces/:workspace/builds', () => {
  it('lists the builds of every team, newest first, each with its team', async () => {
    const body = await listed()
    expect(body.workspace.slug).toBe(acme.workspaceSlug)
    expect(body.next).toBeNull()
    // The docs builds are dated 2030, after the fixture's, so they lead.
    expect(
      body.builds.map((b: { team: { slug: string }; number: number }) => [b.team.slug, b.number]),
    ).toEqual([
      ['docs', 3],
      ['docs', 2],
      ['docs', 1],
      ['web', 2],
      ['web', 1],
    ])
    expect(body.builds[0]).toMatchObject({
      team: { slug: 'docs', name: 'docs' },
      counts: { total: 0 },
    })
    expect(ids(body)).not.toContain(outside.id)
  })

  it('takes the same filters as a team list', async () => {
    expect((await listed('?branch=feature')).builds).toMatchObject([
      { number: 2, team: { slug: 'docs' } },
    ])
    expect((await listed('?author=OCTOCAT')).builds).toMatchObject([{ number: 2 }])
    expect(
      (await listed('?review=approved')).builds.map((b: { team: { slug: string } }) => b.team.slug),
    ).toEqual(['web', 'web'])
    expect(
      (await listed('?from=2030-01-02T00:00:00.000Z&to=2030-01-03T00:00:00.000Z')).builds,
    ).toMatchObject([{ number: 2 }])
    expect((await listed(`?reviewer=${ada.id}`)).builds).toEqual([])
  })

  it('pages with a build id cursor', async () => {
    // Page size is 50: seed enough to need a second page.
    for (let i = 0; i < 48; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ordered fixture
      await seedBuild(db, docs.id, { ...done, createdAt: day(5), branch: 'bulk' })
    }
    const first = await listed()
    expect(first.builds).toHaveLength(50)
    expect(first.next).toBe(first.builds.at(-1).id)
    const second = await listed(`?before=${first.next}`)
    expect(second.builds.length).toBe(3)
    expect(second.next).toBeNull()
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(53)
    expect((await get(url(`?before=${outside.id}`))).statusCode).toBe(404)
    expect((await get(url('?before=00000000-0000-4000-8000-000000000000'))).statusCode).toBe(404)
    expect((await get(url('?before=nope'))).statusCode).toBe(400)
  })

  it('is not found for a non-member, needs a session, and rejects bad filters', async () => {
    expect((await get(url('', ''), '')).statusCode).toBe(401)
    expect((await get(url(), rivalCookie)).statusCode).toBe(404)
    expect((await get(url('', 'nope'))).statusCode).toBe(404)
    expect((await get(url('?status=bogus'))).statusCode).toBe(400)
    // A member who is not an owner sees the workspace's teams too.
    expect((await listed('', adaCookie)).builds.length).toBeGreaterThan(0)
    expect(acmeCookie).toBeTruthy()
  })
})

const suggest = (field: string, q = '', cookie?: string) =>
  get(`${url('/suggestions')}?field=${field}&q=${encodeURIComponent(q)}`, cookie)

describe('GET /api/workspaces/:workspace/builds/suggestions', () => {
  it('suggests members by name for reviewer, and members plus unmatched logins for author', async () => {
    const reviewers = (await suggest('reviewer')).json().suggestions
    expect(reviewers.map((s: { label: string }) => s.label).toSorted()).toEqual([
      'Ada Lovelace',
      expect.stringMatching(/^Owner/),
    ])
    expect(reviewers).toContainEqual({ value: ada.id, label: 'Ada Lovelace', kind: 'member' })
    const authors = (await suggest('author')).json().suggestions
    expect(authors).toContainEqual({ value: 'octocat', label: 'octocat', kind: 'login' })
    expect(authors).toContainEqual({ value: ada.id, label: 'Ada Lovelace', kind: 'member' })
  })

  it('narrows by what is typed, literally, and never offers emails', async () => {
    expect((await suggest('reviewer', 'ada')).json().suggestions).toMatchObject([
      { label: 'Ada Lovelace' },
    ])
    expect((await suggest('author', 'octo')).json().suggestions).toMatchObject([
      { value: 'octocat' },
    ])
    expect((await suggest('author', '%')).json().suggestions).toEqual([])
    expect((await suggest('reviewer', 'acme.test')).json().suggestions).toEqual([])
  })

  it('is not found for a non-member, and rejects an unknown field', async () => {
    expect((await suggest('author', '', rivalCookie)).statusCode).toBe(404)
    expect((await suggest('author', '', '')).statusCode).toBe(401)
    expect((await suggest('branch')).statusCode).toBe(400)
  })
})

const branchesOf = async (query = '', cookie?: string) =>
  (await get(`${url('/branches')}${query}`, cookie))
    .json()
    .branches.map((b: { name: string }) => b.name)

describe('GET /api/workspaces/:workspace/builds/branches', () => {
  it('lists the branches, most recently built first, for the workspace or one team', async () => {
    const all = await branchesOf()
    // The docs builds are dated 2030: `main` (day 3) leads, then `feature` (day 2), then the fixture's.
    expect(all.slice(0, 2)).toEqual(['main', 'feature'])
    expect(await branchesOf(`?team=${docs.slug}`)).toEqual(['main', 'feature'])
    expect(await branchesOf(`?team=${docs.slug}&limit=1`)).toEqual(['main'])
  })

  it('narrows by what is typed, in any case', async () => {
    expect(await branchesOf(`?team=${docs.slug}&q=FEAT`)).toEqual(['feature'])
    expect(await branchesOf('?q=zzz')).toEqual([])
  })

  it('filters the builds list by contains, and exact still means exact', async () => {
    expect(ids(await listed('?branchContains=FEAT'))).toHaveLength(1)
    expect(ids(await listed('?branch=feat'))).toHaveLength(0)
    expect(ids(await listed('?branch=feature'))).toHaveLength(1)
  })

  it('is not found for a non-member or an unknown team, and rejects a bad limit', async () => {
    expect((await get(url('/branches'), rivalCookie)).statusCode).toBe(404)
    expect((await get(url('/branches?team=nope'))).statusCode).toBe(404)
    expect((await get(url('/branches'), '')).statusCode).toBe(401)
    expect((await get(url('/branches?limit=0'))).statusCode).toBe(400)
  })
})
