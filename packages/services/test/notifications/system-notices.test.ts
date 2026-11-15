import { markInstallationNeedsAttention } from '@circi/db/queue'
import {
  createIntegration,
  refreshTriageProblems,
  replaceIntegrationCredentials,
  updateProjectSettings,
} from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  imageSha,
  seedBuild,
  seedDiff,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  backfillTriageProblems,
  changeProjectSettings,
  completeBuild,
  flagInstallationAttention,
  flagIntegrationAttention,
  notifyFlakyDetected,
  TRIAGE_PROBLEMS_BACKFILLED_KEY,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const noticesOf = (userId: string, kind: schema.NotificationKind) =>
  t.db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)))

/** A workspace with an owner, an admin and a plain member, and a connection to Slack. */
async function connectionSetup() {
  const { workspace, owner } = await seedProject(t.db)
  const admin = await seedUser(t.db)
  const plain = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: admin.id, role: 'admin' })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: plain.id })
  const integration = await createIntegration(t.db, {
    workspaceId: workspace.id,
    kind: 'slack',
    displayName: 'Acme Slack',
    externalId: `T${Math.random().toString(36).slice(2, 8)}`,
    encryptedCredentials: 'sealed',
  })
  return { workspace, owner, admin, plain, integration }
}

describe('connection needs attention', () => {
  it('tells the owners and admins once, not plain members, and again after it recovers', async () => {
    const { workspace, owner, admin, plain, integration } = await connectionSetup()
    await flagIntegrationAttention(t.db, integration.id, 'The Slack token was revoked')
    for (const person of [owner, admin]) {
      // oxlint-disable-next-line no-await-in-loop -- two people
      const notices = await noticesOf(person.id, 'connection_needs_attention')
      expect(notices).toHaveLength(1)
      // The workspace is stored on the notice, for the inbox's access checks.
      expect(notices[0]?.workspaceId).toBe(workspace.id)
      expect(notices[0]?.payload).toMatchObject({
        integrationId: integration.id,
        integrationKind: 'slack',
        git: false,
        name: 'Acme Slack',
        reason: 'The Slack token was revoked',
      })
    }
    expect(await noticesOf(plain.id, 'connection_needs_attention')).toEqual([])

    // Failing again while still flagged is not news.
    await flagIntegrationAttention(t.db, integration.id, 'The Slack token was revoked again')
    expect(await noticesOf(owner.id, 'connection_needs_attention')).toHaveLength(1)

    // Reconnecting clears it; the next failure is a new one.
    await replaceIntegrationCredentials(t.db, integration.id, {
      displayName: 'Acme Slack',
      encryptedCredentials: 'sealed-2',
    })
    await flagIntegrationAttention(t.db, integration.id, 'The Slack token was revoked')
    expect(await noticesOf(owner.id, 'connection_needs_attention')).toHaveLength(2)
  })

  it('tells each workspace on a removed installation once', async () => {
    const a = await connectionSetup()
    const b = await connectionSetup()
    const kind = 'github'
    const installationId = `inst-${Math.random().toString(36).slice(2, 8)}`
    const connect = (workspaceId: string) =>
      createIntegration(t.db, {
        workspaceId,
        kind,
        displayName: 'Acme GitHub',
        externalId: installationId,
        encryptedCredentials: null,
      })
    await connect(a.workspace.id)
    await connect(b.workspace.id)
    const input = { kind, installationId, reason: 'The App was removed' }
    await flagInstallationAttention(t.db, input)
    await flagInstallationAttention(t.db, input)
    expect(await noticesOf(a.owner.id, 'connection_needs_attention')).toHaveLength(1)
    expect(await noticesOf(b.admin.id, 'connection_needs_attention')).toHaveLength(1)
    expect(await noticesOf(a.plain.id, 'connection_needs_attention')).toEqual([])
    // GitHub reports on pull requests: the registry says so, and the notice carries it.
    expect((await noticesOf(a.owner.id, 'connection_needs_attention'))[0]?.payload).toMatchObject({
      git: true,
    })
    // A connection flagged earlier by the repository directly is not announced by a later failure.
    expect(
      await markInstallationNeedsAttention(t.db, kind, installationId, 'The App was removed'),
    ).toEqual([])
  })
})

/** A project whose `home` flips A, B, A on the default branch: one more flip makes it flaky. */
async function flakyProject() {
  const seeded = await seedProject(t.db)
  await updateProjectSettings(t.db, seeded.project.id, { flakyAfterChanges: 2 })
  const outsider = await seedUser(t.db)
  await addTestMember(t.db, {
    workspaceId: seeded.workspace.id,
    userId: outsider.id,
    projects: [],
  })
  const teammate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: seeded.workspace.id, userId: teammate.id })
  const build = async (image: string, changed: boolean, status: 'complete' | 'processing') => {
    const b = await seedBuild(t.db, seeded.project.id, { branch: 'main', status })
    await t.db
      .update(schema.builds)
      .set({ baselineSource: 'cli' })
      .where(eq(schema.builds.id, b.id))
    await seedDiff(t.db, {
      buildId: b.id,
      name: 'home',
      status: changed ? 'changed' : 'unchanged',
      headSha256: imageSha(image),
    })
    return b
  }
  await build('A', true, 'complete')
  await build('B', true, 'complete')
  await build('A', false, 'complete')
  await refreshTriageProblems(t.db, seeded.project.id)
  return { ...seeded, teammate, outsider, build }
}

describe('flaky screenshot found', () => {
  it('tells the project members when a build makes a screenshot flaky, and not again while it stays flaky', async () => {
    const { project, owner, teammate, outsider, build } = await flakyProject()
    const stored = () =>
      t.db
        .select()
        .from(schema.triageProblems)
        .where(eq(schema.triageProblems.projectId, project.id))
    expect(await stored()).toEqual([])

    const fourth = await build('B', true, 'processing')
    await completeBuild(t.db, fourth, { conclusion: 'changes_detected', approval: 'none' })
    expect((await stored()).map((p) => `${p.kind}:${p.key}`)).toEqual(['flaky:home'])
    for (const person of [owner, teammate]) {
      // oxlint-disable-next-line no-await-in-loop -- two people
      const notices = await noticesOf(person.id, 'flaky_detected')
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ buildId: fourth.id, payload: { name: 'home', count: 1 } })
    }
    // Someone in the workspace who isn't on the project is left out.
    expect(await noticesOf(outsider.id, 'flaky_detected')).toEqual([])

    // The next build keeps it flaky: it is already flagged, so nobody hears again.
    const fifth = await build('A', true, 'processing')
    await completeBuild(t.db, fifth, { conclusion: 'changes_detected', approval: 'none' })
    expect(await noticesOf(owner.id, 'flaky_detected')).toHaveLength(1)
  })

  it('announces what a lower threshold makes flaky, about the project and no build', async () => {
    const { project, owner, build, workspace } = await flakyProject()
    // A, B, A, B at the threshold of 3 flips is not flaky yet.
    await updateProjectSettings(t.db, project.id, { flakyAfterChanges: 3 })
    await build('B', true, 'complete')
    await refreshTriageProblems(t.db, project.id)
    expect(await noticesOf(owner.id, 'flaky_detected')).toEqual([])
    await changeProjectSettings(t.db, project.id, { flakyAfterChanges: 2 })
    const notices = await noticesOf(owner.id, 'flaky_detected')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ buildId: null, projectId: project.id })
    expect(workspace.id).toBeDefined()
    // Saving the same threshold again changes nothing, so nobody hears twice.
    await changeProjectSettings(t.db, project.id, { flakyAfterChanges: 2 })
    expect(await noticesOf(owner.id, 'flaky_detected')).toHaveLength(1)
  })

  it('has each refresh report only the flaky screenshots it added, once', async () => {
    const { project, build } = await flakyProject()
    await build('B', true, 'complete')
    expect(await refreshTriageProblems(t.db, project.id)).toEqual(['home'])
    expect(await refreshTriageProblems(t.db, project.id)).toEqual([])
  })

  it('keeps the backfill quiet about screenshots that were already flaky', async () => {
    const { project, owner, build } = await flakyProject()
    await build('B', true, 'complete')
    await t.db
      .delete(schema.instanceSettings)
      .where(eq(schema.instanceSettings.key, TRIAGE_PROBLEMS_BACKFILLED_KEY))
    await backfillTriageProblems(t.db)
    const stored = await t.db
      .select()
      .from(schema.triageProblems)
      .where(eq(schema.triageProblems.projectId, project.id))
    expect(stored.map((p) => p.kind)).toContain('flaky')
    expect(await noticesOf(owner.id, 'flaky_detected')).toEqual([])
  })

  it('says nothing for an empty list', async () => {
    const { project, build } = await flakyProject()
    const b = await build('B', true, 'complete')
    expect(
      await notifyFlakyDetected(t.db, { projectId: project.id, buildId: b.id, names: [] }),
    ).toBe(0)
  })
})
