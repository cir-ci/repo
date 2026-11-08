import {
  createBuild,
  createIntegration,
  listBuildActivity,
  listBuildLinks,
  setIntegrationTeam,
} from '@circi/db'
import { createTestDb, seedDiff, seedTeam, seedReview, sha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createIssueFromBuild } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

type Created = Parameters<createIssueFromBuild.Tracker['createIssue']>[0]

function fakeTracker(fail = false) {
  const calls: Created[] = []
  const tracker: createIssueFromBuild.Tracker = {
    async createIssue(input) {
      calls.push(input)
      if (fail) throw new Error('tracker is down')
      return { key: 'WEB-9', url: 'https://acme.atlassian.net/browse/WEB-9', title: input.title }
    },
  }
  return { tracker, calls }
}

async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const integration = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'jira',
    displayName: 'acme.atlassian.net',
    externalId: `acme-${Math.random().toString(36).slice(2)}`,
    encryptedCredentials: 'sealed',
  })
  await setIntegrationTeam(t.db, {
    integrationId: integration.id,
    teamId: team.id,
    externalRef: 'WEB',
  })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abcdef1234',
    branch: 'feat/x',
  })
  await seedDiff(t.db, {
    buildId: build.id,
    name: 'home',
    status: 'changed',
    diffFileSha256: sha('d'),
  })
  await seedReview(t.db, {
    buildId: build.id,
    userId: owner.id,
    state: 'rejected',
    reason: 'cut off',
  })
  return { team, workspace, owner, integration, build }
}

describe('createIssueFromBuild', () => {
  it('files the issue with the build facts and stores the link, which shows in the activity', async () => {
    const { owner, integration, build, workspace, team } = await setup()
    const { tracker, calls } = fakeTracker()
    const link = await createIssueFromBuild(t.db, {
      buildId: build.id,
      snapshotName: 'home',
      integrationId: integration.id,
      userId: owner.id,
      publicOrigin: 'https://ci.test',
      openTracker: (i) => (i.encryptedCredentials === 'sealed' ? tracker : undefined),
    })
    expect(link).toMatchObject({
      kind: 'issue',
      externalRef: 'WEB-9',
      url: 'https://acme.atlassian.net/browse/WEB-9',
      buildId: build.id,
      payload: { snapshotName: 'home' },
      createdBy: owner.id,
    })
    const [call] = calls
    expect(call).toMatchObject({
      target: 'WEB',
      title: `Visual regression: home in build #${build.number}`,
      imageUrl: `https://ci.test/api/files/${sha('d')}`,
    })
    expect(call?.description).toContain(
      `https://ci.test/${workspace.slug}/${team.slug}/builds/${build.number}?shot=home`,
    )
    expect(call?.description).toContain('feat/x')
    expect(call?.description).toContain('cut off')
    expect(await listBuildLinks(t.db, build.id, 'issue')).toHaveLength(1)
    const events = await listBuildActivity(t.db, build.id)
    expect(events.find((e) => e.type === 'issue_created')).toMatchObject({
      issue: { key: 'WEB-9', tracker: 'jira' },
      snapshotName: 'home',
      by: { id: owner.id },
    })
  })

  it('uses the title the person wrote', async () => {
    const { owner, integration, build } = await setup()
    const { tracker, calls } = fakeTracker()
    await createIssueFromBuild(t.db, {
      buildId: build.id,
      integrationId: integration.id,
      title: '  Header broke  ',
      userId: owner.id,
      publicOrigin: 'https://ci.test',
      openTracker: () => tracker,
    })
    expect(calls[0]?.title).toBe('Header broke')
  })

  it('stores nothing when the tracker fails', async () => {
    const { owner, integration, build } = await setup()
    const { tracker } = fakeTracker(true)
    await expect(
      createIssueFromBuild(t.db, {
        buildId: build.id,
        snapshotName: 'home',
        integrationId: integration.id,
        userId: owner.id,
        publicOrigin: 'https://ci.test',
        openTracker: () => tracker,
      }),
    ).rejects.toThrow('tracker is down')
    expect(await listBuildLinks(t.db, build.id, 'issue')).toEqual([])
  })

  it('refuses a tracker the team is not mapped to, an unknown snapshot and unusable credentials', async () => {
    const { owner, integration, build, workspace } = await setup()
    const other = await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'linear',
      displayName: 'Acme',
      externalId: 'lin-1',
    })
    const base = { buildId: build.id, userId: owner.id, publicOrigin: 'https://ci.test' }
    const { tracker, calls } = fakeTracker()
    await expect(
      createIssueFromBuild(t.db, { ...base, integrationId: other.id, openTracker: () => tracker }),
    ).rejects.toThrow('does not file issues')
    await expect(
      createIssueFromBuild(t.db, {
        ...base,
        integrationId: integration.id,
        snapshotName: 'nope',
        openTracker: () => tracker,
      }),
    ).rejects.toThrow('Snapshot not found')
    await expect(
      createIssueFromBuild(t.db, {
        ...base,
        integrationId: integration.id,
        openTracker: () => undefined,
      }),
    ).rejects.toThrow('connect it again')
    expect(calls).toEqual([])
    expect(await listBuildLinks(t.db, build.id, 'issue')).toEqual([])
  })
})
