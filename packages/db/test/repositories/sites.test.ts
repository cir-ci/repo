import { ValidationError } from '@circi/core'
import {
  addTestMember,
  createTestDb,
  seedProject,
  seedSession,
  seedSite,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  commitLabelOfVersion,
  findSiteByLabel,
  getSiteFile,
  listProjectsites,
  servedCommitForBranch,
} from '#src/queries/index.ts'
import {
  consumeSiteToken,
  createSiteSession,
  createSiteToken,
  ensureAssetFiles,
  publishSiteVersion,
  siteSessionValid,
  touchSiteSession,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

let slugCounter = 0
const addressing = {
  chooseSlug: () => `slug${(slugCounter += 1)}`,
  commitLabel: (slug: string, exists: (l: string) => boolean) => {
    const short = `${slug}-c`
    return exists(short) ? `${slug}-clong` : short
  },
  branchLabel: (branch: string, slug: string, exists: (l: string) => boolean) => {
    const short = `${slug}-${branch}`
    return exists(short) ? `${short}-long` : short
  },
}

async function publish(
  projectId: string,
  over: Partial<publishSiteVersion.Input> & { content?: string } = {},
) {
  const { content = 'e', ...rest } = over
  const hash = fakeSha(content)
  await ensureAssetFiles(t.db, [
    { sha256: hash, size: 5, storageKey: `files/${hash}`, contentType: 'text/html' },
  ])
  return publishSiteVersion(t.db, {
    projectId,
    name: 'docs',
    kind: 'generic',
    spa: false,
    commitSha: SHA_A,
    branch: 'main',
    moveBranch: true,
    entryPath: 'index.html',
    files: [{ path: 'index.html', sha256: hash, size: 5, contentType: 'text/html' }],
    addressing,
    slugPrefix: 'slug',
    ...rest,
  })
}

describe('publishing and serving', () => {
  it("creates a site with commit and branch addresses that serve the version's files", async () => {
    const { project, workspace } = await seedProject(t.db)
    const result = await publish(project.id)
    expect(result.replaced).toBe(false)
    expect(result.branchLabel).toBeDefined()

    const served = await findSiteByLabel(t.db, result.commitLabel)
    expect(served).toMatchObject({
      linkKind: 'commit',
      commitSha: SHA_A,
      site: { name: 'docs' },
      workspace: { id: workspace.id },
      project: { id: project.id },
    })
    expect(await findSiteByLabel(t.db, 'unknown')).toBeUndefined()
    expect((await findSiteByLabel(t.db, result.branchLabel ?? ''))?.linkKind).toBe('branch')

    expect(await getSiteFile(t.db, result.version.id, 'index.html')).toMatchObject({
      sha256: fakeSha('e'),
      contentType: 'text/html',
      storageKey: `files/${fakeSha('e')}`,
    })
    expect(await getSiteFile(t.db, result.version.id, 'missing.html')).toBeUndefined()
    expect(await commitLabelOfVersion(t.db, result.version.id)).toBe(result.commitLabel)
  })

  it('replaces a re-run of the same commit in place and moves the branch address on a new one', async () => {
    const { project } = await seedProject(t.db)
    const first = await publish(project.id, { content: '1' })
    const rerun = await publish(project.id, { content: '2' })
    expect(rerun.replaced).toBe(true)
    expect(rerun.version.id).toBe(first.version.id)
    expect(rerun.commitLabel).toBe(first.commitLabel)
    expect((await getSiteFile(t.db, first.version.id, 'index.html'))?.sha256).toBe(fakeSha('2'))

    const next = await publish(project.id, { commitSha: SHA_B, content: '3' })
    expect(next.branchLabel).toBe(first.branchLabel)
    expect(await servedCommitForBranch(t.db, project.id, 'docs', 'main')).toBe(SHA_B)
    expect(await servedCommitForBranch(t.db, project.id, 'docs', 'other')).toBeUndefined()
  })

  it('leaves the branch address where it is unless told to move it', async () => {
    const { project } = await seedProject(t.db)
    await publish(project.id)
    await publish(project.id, { commitSha: SHA_B, moveBranch: false })
    expect(await servedCommitForBranch(t.db, project.id, 'docs', 'main')).toBe(SHA_A)
  })

  it('needs a full commit SHA', async () => {
    const { project } = await seedProject(t.db)
    await expect(publish(project.id, { commitSha: 'abc' })).rejects.toBeInstanceOf(ValidationError)
  })

  it("lists a project's sites with versions and branch addresses", async () => {
    const { project } = await seedProject(t.db)
    const first = await publish(project.id)
    await publish(project.id, { commitSha: SHA_B })
    const [listing] = await listProjectsites(t.db, project.id)
    expect(listing).toMatchObject({ name: 'docs', kind: 'generic' })
    expect(listing?.versions.map((v) => v.commitSha).toSorted()).toEqual([SHA_A, SHA_B])
    expect(listing?.versions.find((v) => v.commitSha === SHA_A)?.commitLabel).toBe(
      first.commitLabel,
    )
    expect(listing?.branches).toMatchObject([{ branch: 'main', commitSha: SHA_B }])
    expect(await listProjectsites(t.db, (await seedProject(t.db)).project.id)).toEqual([])
  })

  it('serves what the seeder inserts, so other packages can rely on it', async () => {
    const { project } = await seedProject(t.db)
    const seeded = await seedSite(t.db, {
      projectId: project.id,
      files: [{ path: 'index.html', sha256: fakeSha('7') }],
    })
    expect((await findSiteByLabel(t.db, seeded.label ?? ''))?.site.id).toBe(seeded.site.id)
  })
})

async function signedIn() {
  const { project, workspace, owner } = await seedProject(t.db)
  const auth = await seedSession(t.db, owner.id)
  return { project, workspace, owner, auth }
}

describe('sign-in handoff', () => {
  it('spends a token once, for its own address only', async () => {
    const { owner, auth } = await signedIn()
    const token = await createSiteToken(t.db, {
      label: 'addr-1',
      userId: owner.id,
      authSessionId: auth.id,
    })
    expect(await consumeSiteToken(t.db, token, 'addr-2')).toBeUndefined()
    expect(await consumeSiteToken(t.db, token, 'addr-1')).toEqual({
      userId: owner.id,
      authSessionId: auth.id,
    })
    expect(await consumeSiteToken(t.db, token, 'addr-1')).toBeUndefined()
  })

  it('refuses an expired token', async () => {
    const { owner, auth } = await signedIn()
    const token = await createSiteToken(t.db, {
      label: 'addr',
      userId: owner.id,
      authSessionId: auth.id,
    })
    await t.db.update(schema.siteTokens).set({ expiresAt: new Date(Date.now() - 1000) })
    expect(await consumeSiteToken(t.db, token, 'addr')).toBeUndefined()
  })

  it('accepts a site session only for its address, a live dashboard session and a current member', async () => {
    const { workspace, owner, auth } = await signedIn()
    const id = await createSiteSession(t.db, {
      label: 'addr',
      userId: owner.id,
      authSessionId: auth.id,
    })
    expect(await siteSessionValid(t.db, { id, label: 'addr', workspaceId: workspace.id })).toBe(
      true,
    )
    expect(await siteSessionValid(t.db, { id, label: 'other', workspaceId: workspace.id })).toBe(
      false,
    )
    expect(
      await siteSessionValid(t.db, { id: 'nope', label: 'addr', workspaceId: workspace.id }),
    ).toBe(false)

    const stranger = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: stranger.id }) // a second member is fine
    const otherWorkspace = (await seedProject(t.db)).workspace
    expect(
      await siteSessionValid(t.db, { id, label: 'addr', workspaceId: otherWorkspace.id }),
    ).toBe(false)

    await t.db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.session.id, auth.id))
    expect(await siteSessionValid(t.db, { id, label: 'addr', workspaceId: workspace.id })).toBe(
      false,
    )
  })

  it("slides a site session's expiry forward", async () => {
    const { owner, auth } = await signedIn()
    const id = await createSiteSession(t.db, {
      label: 'addr',
      userId: owner.id,
      authSessionId: auth.id,
    })
    await t.db
      .update(schema.siteSessions)
      .set({ expiresAt: new Date(Date.now() + 1000) })
      .where(eq(schema.siteSessions.id, id))
    await touchSiteSession(t.db, id)
    const [row] = await t.db
      .select()
      .from(schema.siteSessions)
      .where(eq(schema.siteSessions.id, id))
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000)
  })
})
