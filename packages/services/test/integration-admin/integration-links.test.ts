import { ValidationError } from '@circi/core'
import { sealSecret } from '@circi/core/node'
import { listProjectLinks } from '@circi/db/queries'
import {
  createIntegration,
  createIntegrationLink,
  getProjectIntegration,
  setIntegrationProject,
} from '@circi/db/repositories'
import { createTestDb, seedBuild, seedProject, seedScreenshot } from '@circi/db/testing'
import { defineIntegration, type IntegrationDefinition } from '@circi/integrations'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { addProjectLink, autoLinkProject, mapProject, unmapProject } from '#src/index.ts'

const SECRET = 'instance-secret-for-tests'
const ctx: IntegrationDefinition.Context = {
  authSecret: SECRET,
  publicOrigin: 'https://ci.test',
  config: {},
}

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/**
 * A design integration of the SDK's shape (what the Figma definition is), with files and frames
 * in memory: `asked` records which credentials and file the frames were asked with.
 */
function fakeDesign(files: Record<string, { id: string; name: string }[]>) {
  const asked: { credentials: string; fileRef: string }[] = []
  const definition = defineIntegration({
    id: 'figma',
    group: 'design',
    name: 'Figma',
    description: 'A design tool for tests.',
    logo: 'figma',
    credentials: z.object({ token: z.string().meta({ label: 'Token', secret: true }) }),
    connect: async (input) => ({ externalId: 'x', displayName: 'x', credentials: input.token }),
    needsAttention: () => null,
    events: [],
    capabilities: {
      design: {
        async listFrames(credentials, fileRef) {
          asked.push({ credentials, fileRef })
          const frames = files[fileRef]
          if (!frames) throw new Error('404')
          return frames.map((f) => Object.assign({ page: 'Page 1' }, f))
        },
        render: async () => ({}),
        comment: async () => 'c1',
        linkFor: (fileRef, frame) => ({
          ref: `${fileRef}:${frame.id}`,
          title: frame.name,
          payload: { nodeId: frame.id },
        }),
      },
    },
    mapping: { target: { label: 'File', kind: 'text' } },
    links: {
      kind: 'figma-frame',
      label: 'Frame links',
      targetLabel: 'Frame',
      subject: 'pattern',
      fields: [
        { key: 'pattern', label: 'Screenshot name' },
        { key: 'url', label: 'Frame address' },
      ],
      autoLink: true,
      async resolve(values, input) {
        return {
          ref: `${input.mappingRef ?? 'nofile'}:${values.url}`,
          url: values.url ?? '',
          payload: { nodeId: values.url },
        }
      },
    },
  })
  return { definition, asked }
}

async function seedMapped(snapshots: string[], fileRef: string | null = 'FileKey12345') {
  const { workspace, project } = await seedProject(t.db)
  const integration = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'figma',
    displayName: 'Michael',
    externalId: `u-${workspace.id}`,
    encryptedCredentials: sealSecret(SECRET, 'figd_token'),
  })
  if (fileRef) {
    await setIntegrationProject(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      externalRef: fileRef,
      extra: { name: 'Checkout v3' },
    })
  }
  const build = await seedBuild(t.db, project.id)
  for (const [i, name] of snapshots.entries()) {
    // eslint-disable-next-line no-await-in-loop -- sequential seeding
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha(i.toString(16)), name })
  }
  return { workspace, project, integration }
}

const linksOf = async (projectId: string) =>
  (await listProjectLinks(t.db, projectId, 'figma-frame')).map((l) => [
    l.subject,
    l.externalRef,
    l.payload.source,
    l.title,
  ])

describe('autoLinkProject', () => {
  it('links snapshots to frames by name with the opened credentials', async () => {
    const { project, integration } = await seedMapped(['checkout/cart', 'home', 'about'])
    const { definition, asked } = fakeDesign({
      FileKey12345: [
        { id: '1:1', name: 'Home' },
        { id: '1:2', name: 'Cart' },
        { id: '1:3', name: 'Pricing' },
      ],
    })
    const result = await autoLinkProject(t.db, {
      definition,
      ctx,
      integration,
      projectId: project.id,
    })
    expect(result).toEqual({ created: 2, unlinked: 1, frames: 3 })
    expect(asked).toEqual([{ credentials: 'figd_token', fileRef: 'FileKey12345' }])
    expect(await linksOf(project.id)).toEqual(
      expect.arrayContaining([
        ['home', 'FileKey12345:1:1', 'auto', 'Home'],
        ['checkout/cart', 'FileKey12345:1:2', 'auto', 'Cart'],
      ]),
    )
    const [first] = await listProjectLinks(t.db, project.id, 'figma-frame')
    expect(first?.payload).toMatchObject({ source: 'auto', scope: 'FileKey12345' })
  })

  it('never overwrites a manual link, and is idempotent', async () => {
    const { project, integration } = await seedMapped(['home'])
    await createIntegrationLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject: 'home',
      externalRef: 'FileKey12345:9:9',
      payload: { source: 'manual' },
    })
    const { definition } = fakeDesign({ FileKey12345: [{ id: '1:1', name: 'Home' }] })
    const input = { definition, ctx, integration, projectId: project.id }
    expect(await autoLinkProject(t.db, input)).toEqual({ created: 0, unlinked: 0, frames: 1 })
    expect(await autoLinkProject(t.db, input)).toEqual({ created: 0, unlinked: 0, frames: 1 })
    expect(await linksOf(project.id)).toEqual([['home', 'FileKey12345:9:9', 'manual', null]])
  })

  it('makes no link when two frames match equally', async () => {
    const { project, integration } = await seedMapped(['cart'])
    const { definition } = fakeDesign({
      FileKey12345: [
        { id: '1:1', name: 'Cart' },
        { id: '1:2', name: 'cart' },
      ],
    })
    expect(
      await autoLinkProject(t.db, { definition, ctx, integration, projectId: project.id }),
    ).toMatchObject({ created: 0, unlinked: 1 })
    expect(await linksOf(project.id)).toEqual([])
  })

  it('says what is missing: no mapped file, an unreadable credential, no auto-linking', async () => {
    const { definition } = fakeDesign({})
    const noFile = await seedMapped([], null)
    await expect(
      autoLinkProject(t.db, {
        definition,
        ctx,
        integration: noFile.integration,
        projectId: noFile.project.id,
      }),
    ).rejects.toThrow('Choose a file for this project first')

    const { project, integration } = await seedMapped([])
    await expect(
      autoLinkProject(t.db, {
        definition,
        ctx: { ...ctx, authSecret: 'another-secret' },
        integration,
        projectId: project.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const { links: _links, ...rest } = definition
    await expect(
      autoLinkProject(t.db, {
        definition: { ...rest },
        ctx,
        integration,
        projectId: project.id,
      }),
    ).rejects.toThrow('has no links')
  })
})

describe('addProjectLink', () => {
  it('has the definition resolve the values and replaces the link of the same subject', async () => {
    const { project, integration } = await seedMapped([])
    const { definition } = fakeDesign({})
    const base = { definition, ctx, integration, projectId: project.id }
    const first = await addProjectLink(t.db, {
      ...base,
      values: { pattern: ' cart ', url: 'https://f/1' },
    })
    expect(first).toMatchObject({
      subject: 'cart',
      externalRef: 'FileKey12345:https://f/1',
      url: 'https://f/1',
      payload: { source: 'manual', nodeId: 'https://f/1' },
    })
    const again = await addProjectLink(t.db, {
      ...base,
      values: { pattern: 'cart', url: 'https://f/2' },
    })
    expect(again.id).toBe(first.id)
    expect(await linksOf(project.id)).toHaveLength(1)
  })

  it('works without a mapped file, and wants every field', async () => {
    const { project, integration } = await seedMapped([], null)
    const { definition } = fakeDesign({})
    const base = { definition, ctx, integration, projectId: project.id }
    expect(
      (await addProjectLink(t.db, { ...base, values: { pattern: 'a', url: 'u' } })).externalRef,
    ).toBe('nofile:u')
    await expect(addProjectLink(t.db, { ...base, values: { pattern: 'a' } })).rejects.toThrow(
      'Frame address is required',
    )
    await expect(
      addProjectLink(t.db, { ...base, values: { pattern: 'x'.repeat(201), url: 'u' } }),
    ).rejects.toThrow('Screenshot name is too long')
  })
})

describe('mapProject / unmapProject', () => {
  it('changing the target drops automatic links made for the old one and keeps manual ones', async () => {
    const { project, integration } = await seedMapped(['home'])
    const { definition } = fakeDesign({ FileKey12345: [{ id: '1:1', name: 'Home' }] })
    const input = { definition, ctx, integration, projectId: project.id }
    await autoLinkProject(t.db, input)
    await addProjectLink(t.db, { ...input, values: { pattern: 'manual', url: 'u' } })
    // The same target again keeps every link.
    await mapProject(t.db, {
      definition,
      integrationId: integration.id,
      projectId: project.id,
      ref: 'FileKey12345',
      extra: { name: 'Renamed' },
    })
    expect(await linksOf(project.id)).toHaveLength(2)
    expect((await getProjectIntegration(t.db, project.id, integration.id))?.extra).toEqual({
      name: 'Renamed',
    })
    await mapProject(t.db, {
      definition,
      integrationId: integration.id,
      projectId: project.id,
      ref: 'OtherFile9999',
      extra: {},
    })
    expect((await linksOf(project.id)).map((l) => l[2])).toEqual(['manual'])
    await unmapProject(t.db, { definition, integrationId: integration.id, projectId: project.id })
    expect(await getProjectIntegration(t.db, project.id, integration.id)).toBeUndefined()
    expect(await linksOf(project.id)).toHaveLength(1)
  })

  it('maps and unmaps a definition without links as plain writes', async () => {
    const { project, integration } = await seedMapped([], null)
    const { links: _links, ...definition } = fakeDesign({}).definition
    await mapProject(t.db, {
      definition,
      integrationId: integration.id,
      projectId: project.id,
      ref: 'k',
      extra: {},
    })
    expect(await getProjectIntegration(t.db, project.id, integration.id)).toBeDefined()
    await unmapProject(t.db, { definition, integrationId: integration.id, projectId: project.id })
    expect(await getProjectIntegration(t.db, project.id, integration.id)).toBeUndefined()
  })
})
