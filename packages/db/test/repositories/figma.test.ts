import { createTestDb, seedBuild, seedDiff, seedProject, seedScreenshot, sha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError } from '#src/errors.ts'
import {
  createFigmaLink,
  createIntegration,
  deleteAutoFigmaLinks,
  deleteFigmaLink,
  figmaFramesForSnapshots,
  findFigmaIntegration,
  getBuildDetail,
  getFigmaProjectFile,
  insertAutoFigmaLinks,
  isFigmaAccountClaimedElsewhere,
  listFigmaLinks,
  listFigmaProjects,
  listProjectSnapshotNames,
  rememberFigmaFrames,
  setIntegrationProject,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function seedFigma() {
  const { org, project, owner } = await seedProject(t.db)
  const integration = await createIntegration(t.db, {
    orgId: org.id,
    kind: 'figma',
    displayName: 'Michael',
    externalId: `u-${org.id}`,
    encryptedCredentials: 'sealed',
  })
  await setIntegrationProject(t.db, {
    integrationId: integration.id,
    projectId: project.id,
    externalRef: 'FileKey12345',
    extra: { name: 'Checkout v3' },
  })
  return { org, owner, project, integration }
}

describe('figma repository', () => {
  it('finds the organisation’s connection and whether another organisation uses the account', async () => {
    const { org, integration } = await seedFigma()
    expect((await findFigmaIntegration(t.db, org.id))?.id).toBe(integration.id)
    expect(await isFigmaAccountClaimedElsewhere(t.db, integration.externalId, org.id)).toBe(false)
    const other = await seedProject(t.db)
    expect(await isFigmaAccountClaimedElsewhere(t.db, integration.externalId, other.org.id)).toBe(
      true,
    )
    expect(await findFigmaIntegration(t.db, other.org.id)).toBeUndefined()
  })

  it('lists projects with their file and link counts', async () => {
    const { org, project, integration } = await seedFigma()
    await createFigmaLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      snapshotPattern: 'cart',
      fileKey: 'FileKey12345',
      nodeId: '1:2',
      source: 'manual',
    })
    await rememberFigmaFrames(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      frames: { '1:2': 'Cart' },
      frameCount: 47,
    })
    expect(await listFigmaProjects(t.db, org.id, integration.id)).toEqual([
      {
        projectId: project.id,
        slug: project.slug,
        name: project.name,
        fileKey: 'FileKey12345',
        fileName: 'Checkout v3',
        frameCount: 47,
        linked: 1,
      },
    ])
    expect((await getFigmaProjectFile(t.db, integration.id, project.id))?.extra.frames).toEqual({
      '1:2': 'Cart',
    })
  })

  it('a project without a file is listed with nulls', async () => {
    const { org, owner, integration } = await seedFigma()
    const second = await seedProject(t.db, { org: { org, owner }, slug: 'docs' })
    const rows = await listFigmaProjects(t.db, org.id, integration.id)
    expect(rows.find((r) => r.projectId === second.project.id)).toMatchObject({
      fileKey: null,
      fileName: null,
      frameCount: null,
      linked: 0,
    })
  })

  it('links once per pattern; automatic links never replace a manual one', async () => {
    const { project, integration } = await seedFigma()
    const base = { integrationId: integration.id, projectId: project.id, fileKey: 'FileKey12345' }
    await createFigmaLink(t.db, {
      ...base,
      snapshotPattern: 'cart',
      nodeId: '1:1',
      source: 'manual',
    })
    await expect(
      createFigmaLink(t.db, { ...base, snapshotPattern: 'cart', nodeId: '9:9', source: 'manual' }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(
      await insertAutoFigmaLinks(t.db, [
        { ...base, snapshotPattern: 'cart', nodeId: '2:2' },
        { ...base, snapshotPattern: 'pay', nodeId: '3:3' },
      ]),
    ).toBe(1)
    const links = await listFigmaLinks(t.db, project.id)
    expect(links.map((l) => [l.snapshotPattern, l.nodeId, l.source])).toEqual([
      ['cart', '1:1', 'manual'],
      ['pay', '3:3', 'auto'],
    ])
    await deleteAutoFigmaLinks(t.db, project.id)
    expect((await listFigmaLinks(t.db, project.id)).map((l) => l.source)).toEqual(['manual'])
  })

  it('deletes only the project’s own link', async () => {
    const a = await seedFigma()
    const b = await seedFigma()
    const link = await createFigmaLink(t.db, {
      integrationId: a.integration.id,
      projectId: a.project.id,
      snapshotPattern: 'x',
      fileKey: 'FileKey12345',
      nodeId: '1:1',
      source: 'manual',
    })
    expect(await deleteFigmaLink(t.db, b.project.id, link.id)).toBe(false)
    expect(await deleteFigmaLink(t.db, a.project.id, link.id)).toBe(true)
  })

  it('lists the snapshot names a project uploaded', async () => {
    const { project } = await seedFigma()
    const build = await seedBuild(t.db, project.id)
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('a'), name: 'checkout/cart' })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('b'), name: 'home' })
    expect((await listProjectSnapshotNames(t.db, project.id)).toSorted()).toEqual([
      'checkout/cart',
      'home',
    ])
  })
})

describe('figma frames on snapshots', () => {
  it('gives each snapshot the most specific matching link, with a Figma address', async () => {
    const { project, integration } = await seedFigma()
    const base = { integrationId: integration.id, projectId: project.id, fileKey: 'FileKey12345' }
    await createFigmaLink(t.db, {
      ...base,
      snapshotPattern: 'checkout/*',
      nodeId: '1:1',
      source: 'auto',
    })
    await createFigmaLink(t.db, {
      ...base,
      snapshotPattern: 'checkout/cart',
      nodeId: '2:2',
      source: 'manual',
    })
    await rememberFigmaFrames(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      frames: { '2:2': 'Cart' },
    })
    const frames = await figmaFramesForSnapshots(t.db, project.id, [
      'checkout/cart',
      'checkout/pay',
      'home',
    ])
    expect(frames.get('checkout/cart')).toEqual({
      fileKey: 'FileKey12345',
      nodeId: '2:2',
      url: 'https://www.figma.com/design/FileKey12345?node-id=2-2',
      frameName: 'Cart',
    })
    expect(frames.get('checkout/pay')?.nodeId).toBe('1:1')
    expect(frames.get('checkout/pay')?.frameName).toBeNull()
    expect(frames.has('home')).toBe(false)
  })

  it('shows up on the build detail, and is null without a link', async () => {
    const { project, integration } = await seedFigma()
    await createFigmaLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      snapshotPattern: 'cart',
      fileKey: 'FileKey12345',
      nodeId: '1:2',
      source: 'manual',
    })
    const build = await seedBuild(t.db, project.id)
    await seedDiff(t.db, { buildId: build.id, name: 'cart' })
    await seedDiff(t.db, { buildId: build.id, name: 'home' })
    const detail = await getBuildDetail(t.db, project.id, build.number)
    expect(detail?.diffs.map((d) => [d.name, d.figma?.nodeId ?? null])).toEqual([
      ['cart', '1:2'],
      ['home', null],
    ])
  })
})
