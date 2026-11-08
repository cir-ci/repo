import { openSecret, sealSecret, ValidationError } from '@circi/core'
import { createFigmaLink, createIntegration, getFigmaProjectFile, listFigmaLinks } from '@circi/db'
import { createTestDb, seedBuild, seedProject, seedScreenshot, sha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { autoLinkFigmaFrames, clearFigmaFile, type FigmaFrames, setFigmaFile } from '#src/index.ts'

const SECRET = 'instance-secret-for-tests'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** A Figma fake: files by key with their frames; remembers which token asked. */
function fakeFigma(files: Record<string, { id: string; name: string }[]>) {
  const asked: { token: string; fileKey: string }[] = []
  const figma: FigmaFrames = {
    async listFrames(token, fileKey) {
      asked.push({ token, fileKey })
      const frames = files[fileKey]
      if (!frames) throw new Error('404')
      return frames.map((f) => ({ id: f.id, name: f.name, page: 'Page 1' }))
    },
  }
  return { figma, asked }
}

async function seedFigmaProject(snapshots: string[]) {
  const { org, project } = await seedProject(t.db)
  const integration = await createIntegration(t.db, {
    orgId: org.id,
    kind: 'figma',
    displayName: 'Michael',
    externalId: `u-${org.id}`,
    encryptedCredentials: sealSecret(SECRET, 'figd_token'),
  })
  await setFigmaFile(t.db, {
    projectId: project.id,
    orgId: org.id,
    integrationId: integration.id,
    fileKey: 'FileKey12345',
    fileName: 'Checkout v3',
  })
  const build = await seedBuild(t.db, project.id)
  for (const [i, name] of snapshots.entries()) {
    // eslint-disable-next-line no-await-in-loop -- sequential seeding
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha(i.toString(16)), name })
  }
  return { org, project, integration }
}

describe('autoLinkFigmaFrames', () => {
  it('links snapshots to frames by name with the opened token, and remembers frame names', async () => {
    const { project, integration } = await seedFigmaProject(['checkout/cart', 'home', 'about'])
    const { figma, asked } = fakeFigma({
      FileKey12345: [
        { id: '1:1', name: 'Home' },
        { id: '1:2', name: 'Cart' },
        { id: '1:3', name: 'Pricing' },
      ],
    })
    const result = await autoLinkFigmaFrames(t.db, { projectId: project.id, secret: SECRET, figma })
    expect(result).toEqual({ created: 2, unlinked: 1, frames: 3 })
    expect(asked).toEqual([{ token: 'figd_token', fileKey: 'FileKey12345' }])
    const links = await listFigmaLinks(t.db, project.id)
    expect(links.map((l) => [l.snapshotPattern, l.nodeId, l.source, l.frameName])).toEqual(
      expect.arrayContaining([
        ['home', '1:1', 'auto', 'Home'],
        ['checkout/cart', '1:2', 'auto', 'Cart'],
      ]),
    )
    expect((await getFigmaProjectFile(t.db, integration.id, project.id))?.extra.frameCount).toBe(3)
  })

  it('never overwrites a manual link, and is idempotent', async () => {
    const { project, integration } = await seedFigmaProject(['home'])
    await createFigmaLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      snapshotPattern: 'home',
      fileKey: 'FileKey12345',
      nodeId: '9:9',
      source: 'manual',
    })
    const { figma } = fakeFigma({ FileKey12345: [{ id: '1:1', name: 'Home' }] })
    expect(
      await autoLinkFigmaFrames(t.db, { projectId: project.id, secret: SECRET, figma }),
    ).toEqual({ created: 0, unlinked: 0, frames: 1 })
    expect((await listFigmaLinks(t.db, project.id)).map((l) => [l.nodeId, l.source])).toEqual([
      ['9:9', 'manual'],
    ])
  })

  it('makes no link when two frames match equally', async () => {
    const { project } = await seedFigmaProject(['cart'])
    const { figma } = fakeFigma({
      FileKey12345: [
        { id: '1:1', name: 'Cart' },
        { id: '1:2', name: 'cart' },
      ],
    })
    expect(
      await autoLinkFigmaFrames(t.db, { projectId: project.id, secret: SECRET, figma }),
    ).toMatchObject({ created: 0, unlinked: 1 })
    expect(await listFigmaLinks(t.db, project.id)).toEqual([])
  })

  it('says what is missing: no connection, no file, an unreadable token', async () => {
    const { figma } = fakeFigma({})
    const bare = await seedProject(t.db)
    await expect(
      autoLinkFigmaFrames(t.db, { projectId: bare.project.id, secret: SECRET, figma }),
    ).rejects.toThrow('Figma is not connected')

    const { project } = await seedFigmaProject([])
    await expect(
      autoLinkFigmaFrames(t.db, { projectId: project.id, secret: 'another-secret', figma }),
    ).rejects.toBeInstanceOf(ValidationError)

    const noFile = await seedProject(t.db)
    await createIntegration(t.db, {
      orgId: noFile.org.id,
      kind: 'figma',
      displayName: 'x',
      externalId: 'x1',
      encryptedCredentials: sealSecret(SECRET, 'tok'),
    })
    await expect(
      autoLinkFigmaFrames(t.db, { projectId: noFile.project.id, secret: SECRET, figma }),
    ).rejects.toThrow('Choose a Figma file')
  })
})

describe('setFigmaFile / clearFigmaFile', () => {
  it('changing the file drops automatic links to the old one and keeps manual ones', async () => {
    const { org, project, integration } = await seedFigmaProject(['home'])
    const { figma } = fakeFigma({ FileKey12345: [{ id: '1:1', name: 'Home' }] })
    await autoLinkFigmaFrames(t.db, { projectId: project.id, secret: SECRET, figma })
    await createFigmaLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      snapshotPattern: 'manual',
      fileKey: 'FileKey12345',
      nodeId: '5:5',
      source: 'manual',
    })
    // The same file again keeps what was learned.
    await setFigmaFile(t.db, {
      projectId: project.id,
      orgId: org.id,
      integrationId: integration.id,
      fileKey: 'FileKey12345',
      fileName: 'Renamed',
    })
    expect((await listFigmaLinks(t.db, project.id)).length).toBe(2)
    expect((await getFigmaProjectFile(t.db, integration.id, project.id))?.extra).toMatchObject({
      name: 'Renamed',
      frameCount: 1,
    })
    await setFigmaFile(t.db, {
      projectId: project.id,
      orgId: org.id,
      integrationId: integration.id,
      fileKey: 'OtherFile9999',
      fileName: 'Other',
    })
    expect((await listFigmaLinks(t.db, project.id)).map((l) => l.source)).toEqual(['manual'])
    await clearFigmaFile(t.db, { projectId: project.id, integrationId: integration.id })
    expect(await getFigmaProjectFile(t.db, integration.id, project.id)).toBeUndefined()
  })

  it('stores the token sealed', async () => {
    const { integration } = await seedFigmaProject([])
    expect(integration.encryptedCredentials).not.toContain('figd_token')
    expect(openSecret(SECRET, integration.encryptedCredentials ?? '')).toBe('figd_token')
  })
})
