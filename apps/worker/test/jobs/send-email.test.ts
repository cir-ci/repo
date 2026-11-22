import { type Job } from '@circi/db'
import { QUEUES } from '@circi/db/queue'
import { createBuild, setNotificationPreferences } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb, seedMember, seedNotification, seedProject } from '@circi/db/testing'
import { notify } from '@circi/services'
import { fakeMailer } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sendNotificationEmail } from '#jobs/send-email.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const reviewer = await seedMember(t.db, workspace.id)
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  const notification = await notify(t.db, {
    userId: reviewer.id,
    kind: 'review_requested',
    buildId: build.id,
    actorId: owner.id,
  })
  if (!notification) throw new Error('no notification')
  return { project, workspace, owner, reviewer, build, notification }
}
const jobFor = (notificationId: string): Job => ({
  id: 1,
  queue: QUEUES.notificationEmail,
  payload: { notificationId },
  dedupeKey: null,
  status: 'running',
  attempts: 1,
  maxAttempts: 5,
  runAt: new Date(),
  lockedUntil: null,
  lastError: null,
  createdAt: new Date(),
  finishedAt: null,
})

describe('sendNotificationEmail', () => {
  it('mails the reviewer a link to the build', async () => {
    const { workspace, project, owner, reviewer, build, notification } = await setup()
    const mailer = fakeMailer()
    const { sent } = mailer
    const result = await sendNotificationEmail(
      { db: t.db, mailer, publicOrigin: 'https://ci.acme.io' },
      jobFor(notification.id),
    )
    expect(result).toEqual({ status: 'sent' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(reviewer.email)
    expect(sent[0]?.subject).toContain(owner.name)
    expect(sent[0]?.text).toContain(
      `https://ci.acme.io/${workspace.slug}/${project.slug}/builds/${build.number}`,
    )
  })

  it('sends nothing without SMTP', async () => {
    const { notification } = await setup()
    expect(await sendNotificationEmail({ db: t.db }, jobFor(notification.id))).toEqual({
      status: 'skipped',
      reason: 'SMTP is not configured',
    })
  })

  it('skips a person who opted out, even after the job was queued', async () => {
    const { reviewer, notification } = await setup()
    await setNotificationPreferences(t.db, reviewer.id, { emailReviewRequested: false })
    const mailer = fakeMailer()
    const { sent } = mailer
    expect(await sendNotificationEmail({ db: t.db, mailer }, jobFor(notification.id))).toEqual({
      status: 'skipped',
      reason: 'opted out',
    })
    expect(sent).toEqual([])
  })

  it('skips a notification that was already read or deleted, or one that is not emailed', async () => {
    const { notification } = await setup()
    await t.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, notification.id))
    const mailer = fakeMailer()
    const { sent } = mailer
    expect(
      (await sendNotificationEmail({ db: t.db, mailer }, jobFor(notification.id))).status,
    ).toBe('skipped')

    const mention = await seedNotification(t.db, { userId: notification.userId, kind: 'mentioned' })
    expect((await sendNotificationEmail({ db: t.db, mailer }, jobFor(mention.id))).status).toBe(
      'skipped',
    )
    expect(
      (
        await sendNotificationEmail(
          { db: t.db, mailer },
          jobFor('00000000-0000-4000-8000-000000000000'),
        )
      ).status,
    ).toBe('skipped')
    expect(sent).toEqual([])
  })

  it('lets a failing mailer fail the job so the queue retries', async () => {
    const { notification } = await setup()
    const mailer: sendNotificationEmail.Sender = {
      async send() {
        throw new Error('smtp down')
      },
    }
    await expect(
      sendNotificationEmail({ db: t.db, mailer }, jobFor(notification.id)),
    ).rejects.toThrow('smtp down')
  })
})
