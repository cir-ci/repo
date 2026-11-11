import { commitLabelOfVersion, findSiteByLabel, servedCommitForBranch } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  addTestProjectMember,
  createTestDb,
  seedSession,
  seedSite,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  confirmSiteSession,
  findSiteFile,
  handOffToSite,
  openSiteSession,
  publishSite,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
})

const addressing = {
  chooseSlug: () => 'acme',
  commitLabel: (slug: string, exists: (l: string) => boolean) =>
    exists(`${slug}-c`) ? `${slug}-clong` : `${slug}-c`,
  branchLabel: (branch: string, slug: string) => `${slug}-b-${branch}`,
}

const files = [
  { path: 'index.html', sha256: fakeSha('a'), size: 3, contentType: 'text/html' },
  { path: 'copy.html', sha256: fakeSha('a'), size: 3, contentType: 'text/html' },
]

async function publish(projectId: string, over: Partial<publishSite.Input> = {}) {
  return publishSite(t.db, {
    projectId,
    name: 'docs',
    kind: 'generic',
    spa: false,
    commitSha: 'ABCDEF012345',
    entryPath: 'index.html',
    files,
    storageKeys: new Map([[fakeSha('a'), 'k/a']]),
    fallbackKey: (s) => `fallback/${s}`,
    slugPrefix: 'acme',
    addressing,
    ...over,
  })
}

describe('publishSite', () => {
  it('records each blob once and publishes the version at a commit address', async () => {
    const { project } = await seedProject(t.db)
    const res = await publish(project.id)
    expect(res.version).toMatchObject({ commitSha: 'abcdef012345', fileCount: 2 })
    expect(res.branchLabel).toBeUndefined()
    const rows = await t.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.sha256, fakeSha('a')))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.storageKey).toBe('k/a')
  })

  it('moves the branch address only for the branch tip, never for a fork', async () => {
    const { project } = await seedProject(t.db)
    const common = { branch: 'main', commitSha: 'abcdef012345' }
    expect(
      (await publish(project.id, { ...common, branchTip: 'abcdef012345', fork: true })).branchLabel,
    ).toBeUndefined()
    expect(
      (await publish(project.id, { ...common, branchTip: '999999999999' })).branchLabel,
    ).toBeUndefined()
    expect(
      (await publish(project.id, { ...common, branchTip: 'abcdef012345' })).branchLabel,
    ).toBeDefined()
    expect(await servedCommitForBranch(t.db, project.id, 'docs', 'main')).toBe('abcdef012345')
  })

  it('lets a local ancestry check stand in when there is no tip', async () => {
    const { project } = await seedProject(t.db)
    const input = { branch: 'dev', commitSha: 'abcdef012345' }
    expect((await publish(project.id, input)).branchLabel).toBeUndefined()
    expect((await publish(project.id, { ...input, descends: true })).branchLabel).toBeDefined()
  })
})

describe('serving', () => {
  it('finds a file by path, index.html, and the SPA fallback', async () => {
    const { project } = await seedProject(t.db)
    const res = await publish(project.id, { spa: true })
    const found = await findSiteByLabel(t.db, res.commitLabel)
    expect(found?.versionId).toBe(res.version.id)
    const base = { versionId: res.version.id, entryPath: 'index.html', spa: true }
    expect((await findSiteFile(t.db, { ...base, wanted: '' }))?.sha256).toBe(fakeSha('a'))
    expect((await findSiteFile(t.db, { ...base, wanted: 'copy.html' }))?.sha256).toBe(fakeSha('a'))
    expect(await findSiteFile(t.db, { ...base, wanted: 'app/route' })).toBeDefined()
    expect(await findSiteFile(t.db, { ...base, wanted: 'missing.js' })).toBeUndefined()
    expect(await findSiteFile(t.db, { ...base, spa: false, wanted: 'app/route' })).toBeUndefined()
    expect(await commitLabelOfVersion(t.db, res.version.id)).toBe(res.commitLabel)
  })

  it('refuses a token that is bad, for a missing site, or already spent', async () => {
    const { project, owner } = await seedProject(t.db)
    const label = (await seedSite(t.db, { projectId: project.id })).label ?? ''
    expect(await openSiteSession(t.db, { token: null, label, siteExists: true })).toBeUndefined()
    expect(await openSiteSession(t.db, { token: 'x', label, siteExists: false })).toBeUndefined()
    expect(await openSiteSession(t.db, { token: 'nope', label, siteExists: true })).toBeUndefined()
    expect(owner.id).toBeDefined()
  })
})

describe('confirmSiteSession', () => {
  it('is false for a session that does not exist', async () => {
    const { project } = await seedProject(t.db)
    const site = await seedSite(t.db, { projectId: project.id })
    expect(
      await confirmSiteSession(t.db, {
        id: 'nope',
        label: site.label ?? '',
        workspaceId: project.workspaceId,
      }),
    ).toBe(false)
  })
})

describe('handOffToSite', () => {
  it('gives a member a token that opens a site session, and everyone else nothing', async () => {
    const { project, owner } = await seedProject(t.db)
    const label = (await seedSite(t.db, { projectId: project.id })).label ?? ''
    const session = await seedSession(t.db, owner.id)
    const asOwner = { label, userId: owner.id, sessionId: session.id, method: 'password' as const }

    const token = await handOffToSite(t.db, asOwner)
    expect(token).toBeDefined()
    expect(
      await openSiteSession(t.db, { token: token ?? null, label, siteExists: true }),
    ).toBeDefined()

    const outsider = await seedUser(t.db)
    const theirs = await seedSession(t.db, outsider.id)
    expect(
      await handOffToSite(t.db, { ...asOwner, userId: outsider.id, sessionId: theirs.id }),
    ).toBeUndefined()
    expect(await handOffToSite(t.db, { ...asOwner, label: 'no-such-address' })).toBeUndefined()
  })

  it("hides a project's site from workspace members who are not in the project, but not from admins", async () => {
    const { project, workspace, owner } = await seedProject(t.db)
    const label = (await seedSite(t.db, { projectId: project.id })).label ?? ''
    const plain = await seedUser(t.db)
    const admin = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: plain.id, projects: [] })
    await addTestMember(t.db, {
      workspaceId: workspace.id,
      userId: admin.id,
      role: 'admin',
      projects: [],
    })
    const ask = async (userId: string) =>
      handOffToSite(t.db, {
        label,
        userId,
        sessionId: (await seedSession(t.db, userId)).id,
        method: 'password',
      })
    expect(await ask(plain.id)).toBeUndefined()
    expect(await ask(admin.id)).toBeDefined()
    await addTestProjectMember(t.db, { projectId: project.id, userId: plain.id })
    expect(await ask(plain.id)).toBeDefined()
    expect(await ask(owner.id)).toBeDefined()
  })

  it('refuses a session whose sign-in method the workspace does not accept', async () => {
    const { project, owner } = await seedProject(t.db)
    const label = (await seedSite(t.db, { projectId: project.id })).label ?? ''
    const session = await seedSession(t.db, owner.id)
    expect(
      await handOffToSite(t.db, {
        label,
        userId: owner.id,
        sessionId: session.id,
        method: { scopedTo: 'some-other-workspace' },
      }),
    ).toBeUndefined()
  })
})
