import { createTestDb, seedBuild, seedDiff, seedProject, seedScreenshot } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { figmaFramesForSnapshots, getBuildDetail } from '#src/queries/index.ts'
import {
  createIntegration,
  createIntegrationLink,
  listProjectSnapshotNames,
} from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function seedFigma() {
  const { workspace, project } = await seedProject(t.db)
  const integration = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'figma',
    displayName: 'Michael',
    externalId: `u-${workspace.id}`,
    encryptedCredentials: 'sealed',
  })
  return { workspace, project, integration }
}

/** A `figma-frame` link as the Figma definition stores it. */
const frameLink = (
  input: { integrationId: string; projectId: string },
  link: { pattern: string; nodeId: string; source: 'auto' | 'manual'; title?: string },
) =>
  createIntegrationLink(t.db, {
    integrationId: input.integrationId,
    projectId: input.projectId,
    kind: 'figma-frame',
    subject: link.pattern,
    externalRef: `FileKey12345:${link.nodeId}`,
    title: link.title ?? null,
    payload: { fileKey: 'FileKey12345', nodeId: link.nodeId, source: link.source },
  })

describe('snapshot names', () => {
  it('lists the names a project uploaded', async () => {
    const { project } = await seedFigma()
    const build = await seedBuild(t.db, project.id)
    await seedScreenshot(t.db, {
      buildId: build.id,
      fileSha256: fakeSha('a'),
      name: 'checkout/cart',
    })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('b'), name: 'home' })
    expect((await listProjectSnapshotNames(t.db, project.id)).toSorted()).toEqual([
      'checkout/cart',
      'home',
    ])
  })
})

describe('figma frames on snapshots', () => {
  it('gives each snapshot the most specific matching link, with a Figma address', async () => {
    const { project, integration } = await seedFigma()
    const base = { integrationId: integration.id, projectId: project.id }
    await frameLink(base, { pattern: 'checkout/*', nodeId: '1:1', source: 'auto' })
    await frameLink(base, {
      pattern: 'checkout/cart',
      nodeId: '2:2',
      source: 'manual',
      title: 'Cart',
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

  it('ignores links of other kinds, and a link without a frame', async () => {
    const { project, integration } = await seedFigma()
    await createIntegrationLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      kind: 'other',
      subject: 'home',
      externalRef: 'x',
      payload: { fileKey: 'FileKey12345', nodeId: '1:1' },
    })
    await createIntegrationLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject: 'cart',
      externalRef: 'broken',
    })
    expect((await figmaFramesForSnapshots(t.db, project.id, ['home', 'cart'])).size).toBe(0)
  })

  it('shows up on the build detail, and is null without a link', async () => {
    const { project, integration } = await seedFigma()
    await frameLink(
      { integrationId: integration.id, projectId: project.id },
      { pattern: 'cart', nodeId: '1:2', source: 'manual' },
    )
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
