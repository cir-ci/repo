import { randomUUID } from 'node:crypto'

import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedMember,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError } from '#src/index.ts'
import {
  listBuildFilterSuggestions,
  listBuildsForWorkspace,
  SUGGESTION_LIMIT,
} from '#src/queries/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n))

/** A workspace with two projects ("web", "docs") and an owner; every test makes its own. */
async function workspaceWithProjects() {
  const first = await seedProject(t.db, { slug: 'web' })
  const docs = await seedProject(t.db, { slug: 'docs', workspace: first })
  return { workspace: first.workspace, owner: first.owner, web: first.project, docs: docs.project }
}

const list = (
  w: { workspace: { slug: string } },
  userId: string,
  over: Partial<Parameters<typeof listBuildsForWorkspace>[1]> = {},
) => listBuildsForWorkspace(t.db, { userId, workspaceSlug: w.workspace.slug, limit: 50, ...over })

describe('listBuildsForWorkspace', () => {
  it('lists the builds of every project, newest first, each with its project', async () => {
    const w = await workspaceWithProjects()
    const a = await seedBuild(t.db, w.web.id, { createdAt: at(1) })
    const b = await seedBuild(t.db, w.docs.id, { createdAt: at(2) })
    const c = await seedBuild(t.db, w.web.id, { createdAt: at(3) })
    const result = await list(w, w.owner.id)
    expect(result?.workspace).toEqual({ slug: w.workspace.slug, name: w.workspace.name })
    expect(result?.builds.map((x) => [x.id, x.project.slug])).toEqual([
      [c.id, 'web'],
      [b.id, 'docs'],
      [a.id, 'web'],
    ])
  })

  it("never shows another workspace's builds", async () => {
    const mine = await workspaceWithProjects()
    const theirs = await workspaceWithProjects()
    await seedBuild(t.db, theirs.web.id)
    const own = await seedBuild(t.db, mine.web.id)
    const result = await list(mine, mine.owner.id)
    expect(result?.builds.map((x) => x.id)).toEqual([own.id])
  })

  it('is invisible to someone who is not a member', async () => {
    const w = await workspaceWithProjects()
    await seedBuild(t.db, w.web.id)
    const stranger = await seedUser(t.db)
    expect(await list(w, stranger.id)).toBeUndefined()
    expect(
      await listBuildsForWorkspace(t.db, {
        userId: w.owner.id,
        workspaceSlug: 'no-such-workspace',
        limit: 5,
      }),
    ).toBeUndefined()
  })

  it('shows a plain member the same list as the owner', async () => {
    const w = await workspaceWithProjects()
    const build = await seedBuild(t.db, w.docs.id)
    const member = await seedMember(t.db, w.workspace.id)
    expect((await list(w, member.id))?.builds.map((x) => x.id)).toEqual([build.id])
  })

  it('is invisible once the workspace is deleted', async () => {
    const w = await workspaceWithProjects()
    await seedBuild(t.db, w.web.id)
    await t.db.insert(schema.workspaceDeletions).values({ workspaceId: w.workspace.id })
    expect(await list(w, w.owner.id)).toBeUndefined()
  })

  it("applies the workspace's login-method rules to the session", async () => {
    const w = await workspaceWithProjects()
    await seedBuild(t.db, w.web.id)
    await t.db
      .insert(schema.workspaceAuthSettings)
      .values({ workspaceId: w.workspace.id, signinGithub: false })
    expect(await list(w, w.owner.id, { method: { oidcProvider: 'github' } })).toBeUndefined()
    expect(
      (await list(w, w.owner.id, { method: { oidcProvider: 'google' } }))?.builds,
    ).toHaveLength(1)
    expect((await list(w, w.owner.id, { method: 'password' }))?.builds).toHaveLength(1)
  })

  it('pages with a build id: the next page starts after that build, without repeats', async () => {
    const w = await workspaceWithProjects()
    const made = []
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- numbering is sequential
      made.push(await seedBuild(t.db, (i % 2 ? w.web : w.docs).id, { createdAt: at(i) }))
    }
    const newestFirst = made.toReversed().map((b) => b.id)
    const first = await list(w, w.owner.id, { limit: 2 })
    expect(first?.builds.map((b) => b.id)).toEqual(newestFirst.slice(0, 2))
    const second = await list(w, w.owner.id, { limit: 2, before: first?.builds.at(-1)?.id ?? '' })
    expect(second?.builds.map((b) => b.id)).toEqual(newestFirst.slice(2, 4))
    const third = await list(w, w.owner.id, { limit: 2, before: second?.builds.at(-1)?.id ?? '' })
    expect(third?.builds.map((b) => b.id)).toEqual(newestFirst.slice(4))
  })

  it('refuses a cursor that is not a build of this workspace', async () => {
    const mine = await workspaceWithProjects()
    const theirs = await workspaceWithProjects()
    const foreign = await seedBuild(t.db, theirs.web.id)
    await expect(list(mine, mine.owner.id, { before: foreign.id })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(list(mine, mine.owner.id, { before: randomUUID() })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it("filters like a project's list: by branch, review state and author", async () => {
    const w = await workspaceWithProjects()
    const grace = await seedUser(t.db)
    const main = await seedBuild(t.db, w.web.id, { branch: 'main', createdAt: at(1) })
    const feature = await seedBuild(t.db, w.docs.id, {
      branch: 'feature/x',
      author: { userId: grace.id },
      createdAt: at(2),
    })
    const login = await seedBuild(t.db, w.docs.id, {
      branch: 'main',
      author: { login: 'Octo' },
      createdAt: at(3),
    })
    const ids = async (
      filters: NonNullable<Parameters<typeof listBuildsForWorkspace>[1]['filters']>,
    ) => (await list(w, w.owner.id, { filters }))?.builds.map((b) => b.id)
    expect(await ids({ branch: 'main' })).toEqual([login.id, main.id])
    expect(await ids({ author: grace.id })).toEqual([feature.id])
    expect(await ids({ author: 'octo' })).toEqual([login.id])
    expect(await ids({ branch: 'nope' })).toEqual([])
  })
})

const suggest = (
  w: { workspace: { slug: string } },
  userId: string,
  field: listBuildFilterSuggestions.Field,
  query = '',
  limit?: number,
) =>
  listBuildFilterSuggestions(t.db, {
    userId,
    workspaceSlug: w.workspace.slug,
    field,
    query,
    ...(limit ? { limit } : {}),
  })

async function withMembers() {
  const w = await workspaceWithProjects()
  const grace = await seedUser(t.db)
  const alan = await seedUser(t.db)
  await t.db.update(schema.user).set({ name: 'Grace Hopper' }).where(eq(schema.user.id, grace.id))
  await t.db.update(schema.user).set({ name: 'Alan Turing' }).where(eq(schema.user.id, alan.id))
  await addTestMember(t.db, { workspaceId: w.workspace.id, userId: grace.id })
  await addTestMember(t.db, { workspaceId: w.workspace.id, userId: alan.id })
  return { ...w, grace, alan }
}

describe('listBuildFilterSuggestions', () => {
  it("offers the workspace's members by name, as user ids, in name order", async () => {
    const w = await withMembers()
    const items = await suggest(w, w.owner.id, 'reviewer')
    expect(items?.map((i) => i.label)).toEqual(['Alan Turing', 'Grace Hopper', w.owner.name])
    expect(items?.find((i) => i.label === 'Alan Turing')).toEqual({
      value: w.alan.id,
      label: 'Alan Turing',
      kind: 'member',
    })
  })

  it('matches what is typed anywhere in a name, ignoring case, and literally', async () => {
    const w = await withMembers()
    expect((await suggest(w, w.owner.id, 'reviewer', 'HOPP'))?.map((i) => i.label)).toEqual([
      'Grace Hopper',
    ])
    // `%` and `_` are text, not wildcards.
    expect(await suggest(w, w.owner.id, 'reviewer', '%')).toEqual([])
    expect(await suggest(w, w.owner.id, 'reviewer', 'Gr_ce')).toEqual([])
  })

  it('adds git logins nobody was matched to, for authors only', async () => {
    const w = await withMembers()
    await seedBuild(t.db, w.web.id, { author: { login: 'octocat' } })
    await seedBuild(t.db, w.docs.id, { author: { login: 'octocat' } })
    await seedBuild(t.db, w.web.id, { author: { login: 'matched', userId: w.grace.id } })
    const authors = await suggest(w, w.owner.id, 'author', 'octo')
    expect(authors).toEqual([{ value: 'octocat', label: 'octocat', kind: 'login' }])
    const everyone = await suggest(w, w.owner.id, 'author')
    expect(everyone?.filter((i) => i.kind === 'login').map((i) => i.value)).toEqual(['octocat'])
    const reviewers = await suggest(w, w.owner.id, 'reviewer', 'octo')
    expect(reviewers).toEqual([])
  })

  it('stops at the limit, members first', async () => {
    const w = await withMembers()
    await seedBuild(t.db, w.web.id, { author: { login: 'octocat' } })
    expect(await suggest(w, w.owner.id, 'author', '', 3)).toHaveLength(3)
    expect((await suggest(w, w.owner.id, 'author', '', 3))?.every((i) => i.kind === 'member')).toBe(
      true,
    )
    expect(SUGGESTION_LIMIT).toBeGreaterThan(3)
  })

  it("does not offer another workspace's people or logins, nor anything to a stranger", async () => {
    const mine = await workspaceWithProjects()
    const theirs = await workspaceWithProjects()
    await seedBuild(t.db, theirs.web.id, { author: { login: 'elsewhere' } })
    const own = await suggest(mine, mine.owner.id, 'author')
    expect(own?.map((i) => i.value)).toEqual([mine.owner.id])
    expect(await suggest(mine, theirs.owner.id, 'author')).toBeUndefined()
  })
})
