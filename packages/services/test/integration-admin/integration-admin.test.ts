import { NotFoundError } from '@circi/core'
import { openSecret } from '@circi/core/node'
import { getIntegration, getSetting, listProjectLinks } from '@circi/db/queries'
import { createIntegration, createIntegrationLink } from '@circi/db/repositories'
import { createTestDb, seedProject } from '@circi/db/testing'
import {
  defineIntegration,
  IntegrationConflictError,
  type IntegrationDefinition,
} from '@circi/integrations'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'

import {
  claimWebhookDelivery,
  connectIntegration,
  flagFailedIntegration,
  githubAppSync,
  publicUrlProblem,
  readStoredGithubApp,
  removeIntegration,
  removeProjectLink,
  storeGithubApp,
  useStoredGithubApp,
} from '#src/index.ts'

const SECRET = 'instance-secret-for-tests'
const ctx: IntegrationDefinition.Context = {
  authSecret: SECRET,
  publicOrigin: 'https://ci.test',
  config: {},
}

let t: createTestDb.Result
const seedWorkspace = async (db: createTestDb.Result['db']) => {
  const { workspace, owner } = await seedProject(db)
  return { workspace, owner }
}
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

function fakeDefinition(options: Partial<IntegrationDefinition> = {}) {
  return defineIntegration({
    id: 'figma',
    group: 'design',
    name: 'Figma',
    description: 'A tool for tests.',
    logo: 'figma',
    credentials: z.object({ token: z.string().meta({ label: 'Token', secret: true }) }),
    connect: async () => ({ externalId: 'x', displayName: 'x', credentials: 't' }),
    needsAttention: (e) => (e instanceof Error && e.message === 'revoked' ? 'Token revoked' : null),
    events: [],
    capabilities: {
      design: {
        listFrames: async () => [],
        render: async () => ({}),
        comment: async () => 'c1',
        linkFor: (fileRef, frame) => ({ ref: `${fileRef}:${frame.id}`, title: frame.name }),
      },
    },
    mapping: { target: { label: 'File', kind: 'text' } },
    ...options,
  })
}

const connected = (externalId: string, credentials = 'figd_1') => ({
  externalId,
  displayName: `Name ${externalId}`,
  credentials,
})

describe('connectIntegration', () => {
  it('stores a new account with sealed credentials and returns its id', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const id = await connectIntegration(t.db, {
      workspaceId: workspace.id,
      userId: owner.id,
      definition: fakeDefinition(),
      connected: connected('a1'),
      ctx,
      replace: false,
    })
    const row = await getIntegration(t.db, workspace.id, id)
    expect(row?.displayName).toBe('Name a1')
    expect(row?.encryptedCredentials).not.toContain('figd_1')
    expect(openSecret(SECRET, row?.encryptedCredentials ?? '')).toBe('figd_1')
  })

  it('replaces the credentials of the same account when asked to, and clears nothing else', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const base = { workspaceId: workspace.id, userId: owner.id, definition: fakeDefinition(), ctx }
    const first = await connectIntegration(t.db, {
      ...base,
      connected: connected('a1'),
      replace: false,
    })
    const second = await connectIntegration(t.db, {
      ...base,
      connected: connected('a1', 'figd_2'),
      replace: true,
    })
    expect(second).toBe(first)
    const row = await getIntegration(t.db, workspace.id, first)
    expect(openSecret(SECRET, row?.encryptedCredentials ?? '')).toBe('figd_2')
  })

  it('refuses an exclusive account another workspace uses, and the same account twice', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    const definition = fakeDefinition({ exclusive: { account: true } })
    const input = (w: typeof one) => ({
      workspaceId: w.workspace.id,
      userId: w.owner.id,
      definition,
      connected: connected('shared'),
      ctx,
      replace: false,
    })
    await connectIntegration(t.db, input(one))
    await expect(connectIntegration(t.db, input(two))).rejects.toThrow(IntegrationConflictError)
    await expect(connectIntegration(t.db, input(one))).rejects.toThrow(/already|exists|connected/i)
  })
})

describe('removeIntegration', () => {
  it("removes the workspace's integration and refuses another workspace's", async () => {
    const mine = await seedWorkspace(t.db)
    const other = await seedWorkspace(t.db)
    const integration = await createIntegration(t.db, {
      workspaceId: mine.workspace.id,
      kind: 'figma',
      displayName: 'x',
      externalId: 'x1',
      encryptedCredentials: null,
    })
    await expect(
      removeIntegration(t.db, { workspaceId: other.workspace.id, integrationId: integration.id }),
    ).rejects.toThrow(NotFoundError)
    await removeIntegration(t.db, {
      workspaceId: mine.workspace.id,
      integrationId: integration.id,
    })
    expect(await getIntegration(t.db, mine.workspace.id, integration.id)).toBeUndefined()
    await expect(
      removeIntegration(t.db, { workspaceId: mine.workspace.id, integrationId: integration.id }),
    ).rejects.toThrow('Integration not found')
  })
})

describe('removeProjectLink', () => {
  it("removes the project's link, and says so when it is not there", async () => {
    const { workspace, project } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const integration = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'figma',
      displayName: 'x',
      externalId: 'x2',
      encryptedCredentials: null,
    })
    const link = await createIntegrationLink(t.db, {
      integrationId: integration.id,
      projectId: project.id,
      kind: 'figma-frame',
      subject: 'home',
      externalRef: 'F:1:1',
      payload: {},
    })
    const input = { integrationId: integration.id, projectId: project.id, linkId: link.id }
    await expect(
      removeProjectLink(t.db, { ...input, projectId: other.project.id }),
    ).rejects.toThrow(NotFoundError)
    await removeProjectLink(t.db, input)
    expect(await listProjectLinks(t.db, project.id, 'figma-frame')).toEqual([])
    await expect(removeProjectLink(t.db, input)).rejects.toThrow('Link not found')
  })
})

describe('flagFailedIntegration', () => {
  it('flags the integration when the definition recognises the error, otherwise changes nothing', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const integration = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'figma',
      displayName: 'x',
      externalId: 'x3',
      encryptedCredentials: null,
    })
    const definition = fakeDefinition()
    const base = { integrationId: integration.id, definition }
    expect(await flagFailedIntegration(t.db, { ...base, error: new Error('timeout') })).toBe(
      undefined,
    )
    expect((await getIntegration(t.db, workspace.id, integration.id))?.needsAttention).toBe(false)
    expect(
      await flagFailedIntegration(t.db, {
        integrationId: integration.id,
        definition: undefined,
        error: new Error('revoked'),
      }),
    ).toBe(undefined)
    expect(await flagFailedIntegration(t.db, { ...base, error: new Error('revoked') })).toBe(
      'Token revoked',
    )
    const row = await getIntegration(t.db, workspace.id, integration.id)
    expect(row?.needsAttention).toBe(true)
    expect(row?.needsAttentionReason).toBe('Token revoked')
  })
})

describe('the stored GitHub App', () => {
  const app = {
    appId: '77',
    slug: 'circi-test',
    clientId: 'Iv1.x',
    clientSecret: 'client-secret',
    // Has spaces, which base64url never does, so the sealed value can't contain it by chance (a bare 'PEM' once did).
    privateKey: '-----BEGIN PRIVATE KEY----- test key -----END PRIVATE KEY-----',
    webhookSecret: 'whsec',
    htmlUrl: 'https://github.com/apps/circi-test',
    apiUrl: 'https://api.github.com',
  }

  it('seals the secrets, reads them back, fills the live config and syncs another replica', async () => {
    const own = await createTestDb()
    onTestFinished(() => own.close())
    const db = own.db
    expect(await readStoredGithubApp(db, SECRET)).toBeUndefined()
    await storeGithubApp(db, SECRET, app)
    expect(await getSetting(db, 'github_app')).not.toContain('PRIVATE KEY')
    expect(await readStoredGithubApp(db, SECRET)).toEqual(app)
    expect(await readStoredGithubApp(db, 'another-secret-entirely')).toBeUndefined()

    const config: IntegrationDefinition.InstanceConfig = {}
    expect(await useStoredGithubApp(db, SECRET, config)).toBe(true)
    expect(config.github?.appId).toBe('77')

    const replica: IntegrationDefinition.InstanceConfig = {}
    const sync = githubAppSync({ db, authSecret: SECRET, config: replica })
    expect(await sync.refresh()).toBe(true)
    expect(await sync.refresh()).toBe(false)
    expect(replica.github?.webhookSecret).toBe('whsec')
  })

  it('says which public addresses GitHub cannot reach', () => {
    expect(publicUrlProblem('https://ci.acme.io')).toEqual({ blocked: null, warning: null })
    expect(publicUrlProblem('http://localhost:3000').warning).toContain('only reachable')
    expect(publicUrlProblem('http://ci.acme.io').blocked).toContain('https')
  })
})

describe('claimWebhookDelivery', () => {
  it('is true once per delivery id', async () => {
    expect(await claimWebhookDelivery(t.db, 'delivery-1')).toBe(true)
    expect(await claimWebhookDelivery(t.db, 'delivery-1')).toBe(false)
    expect(await claimWebhookDelivery(t.db, 'delivery-2')).toBe(true)
  })
})
