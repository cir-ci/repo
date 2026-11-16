import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addMemberViaCli,
  addProjectMembers,
  approveBuild,
  createProject,
  createUserViaCli,
  newAccount,
  signIn,
} from '#clients/admin.ts'
import { LiveStream } from '#clients/live.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * Live updates (`GET /api/live`) on the real stack: Postgres LISTEN/NOTIFY, the built image's
 * server and worker, the real CLI. Streams are opened the way the dashboard's EventSource does,
 * with the session cookie from the real sign-in.
 */
describe('live updates: who hears what', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const streams: LiveStream[] = []
  let repo: Repo

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    for (const stream of streams) stream.close()
    await repo.destroy()
  })

  const open = async (...args: Parameters<typeof LiveStream.open>) => {
    const stream = await LiveStream.open(...args)
    streams.push(stream)
    return stream
  }
  const upload = async (token: string, label: string, x: number) => {
    await repo.writeShots({ home: { dot: { x, y: x } } })
    await repo.commit(label)
    return uploadOrThrow({ stack: ctx.stack, token, repo, wait: true })
  }

  it('an upload and a review reach the owner, in order, as ids and slugs only', async () => {
    const { setup } = ctx
    const ws = setup.workspace.slug
    const project = await createProject(setup.session, ws, 'Live web')
    const stream = await open(setup.session)
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    expect(stream.headers.get('x-accel-buffering')).toBe('no')
    expect(stream.headers.get('cache-control')).toContain('no-cache')

    const up = await upload(project.token, 'first', 10)
    const number = up.build.number
    const finalized = await stream.waitFor(
      (e) => e.type === 'build.finalized' && e.build === number,
    )
    expect(finalized.event).toEqual({
      type: 'build.finalized',
      workspace: ws,
      project: project.slug,
      build: number,
    })
    // The build was announced before it finished.
    const created = stream.of('build.created')
    expect(created.some((e) => e.event.build === number)).toBe(true)
    expect(created[0]!.at).toBeLessThanOrEqual(finalized.at)

    await approveBuild(setup.session, ws, project.slug, number)
    const reviewed = await stream.waitFor((e) => e.type === 'review.changed' && e.build === number)
    expect(reviewed.event).toMatchObject({ workspace: ws, project: project.slug })
    // Nothing but ids and slugs: no names, no paths.
    expect(JSON.stringify(stream.events.map((e) => e.event))).not.toContain('Live web')
  })

  it('a member outside the project hears nothing about it, and a member inside hears it', async () => {
    const { stack, setup } = ctx
    const ws = setup.workspace.slug
    const secret = await createProject(setup.session, ws, 'Secret')
    const shared = await createProject(setup.session, ws, 'Shared')

    const member = await createUserViaCli(stack, { account: newAccount('member') })
    await addMemberViaCli(stack, ws, member.email, 'member')
    const memberId = (
      await stack.sql(`select id from "user" where email = '${member.email}'`)
    )[0]![0]!
    await addProjectMembers(setup.session, ws, shared.slug, [memberId])
    const session = await signIn(stack, member.email, member.password)

    const owner = await open(setup.session)
    const outsider = await open(session)
    expect(outsider.status).toBe(200)

    const first = await upload(secret.token, 'secret', 30)
    await owner.waitFor((e) => e.type === 'build.finalized' && e.project === secret.slug)
    await approveBuild(setup.session, ws, secret.slug, first.build.number)
    await owner.waitFor((e) => e.type === 'review.changed' && e.project === secret.slug)

    // A later change the member may see: notices are delivered in order, so when it arrives
    // everything about the secret project was already offered to this stream.
    const second = await upload(shared.token, 'shared', 40)
    const heard = await outsider.waitFor(
      (e) => e.type === 'build.finalized' && e.project === shared.slug,
    )
    expect(heard.event.build).toBe(second.build.number)
    expect(outsider.events.map((e) => e.event.project).filter((p) => p === secret.slug)).toEqual([])
    expect(JSON.stringify(outsider.events)).not.toContain(secret.slug)
  })

  it('signing out ends the stream at once, and the next connection is refused', async () => {
    const { stack, setup } = ctx
    const person = await createUserViaCli(stack, { account: newAccount('leaver') })
    await addMemberViaCli(stack, setup.workspace.slug, person.email, 'member')
    const session = await signIn(stack, person.email, person.password)
    const stream = await open(session)
    expect(stream.status).toBe(200)
    expect(stream.ended).toBe(false)

    // The old cookie, kept: it must be dead on the server, not only gone from the jar.
    const stale = session.on(session.url)
    const began = performance.now()
    await session.signOut()
    await stream.waitForEnd(5_000)
    // Not the 25 s heartbeat: the sign-out itself is a notice.
    expect(performance.now() - began).toBeLessThan(3_000)

    const again = await open(stale)
    expect(again.status).toBe(401)
  })
})
