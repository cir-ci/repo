import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject } from '#clients/admin.ts'
import { LiveStream } from '#clients/live.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import type { Stack } from '#stack/stack.ts'
import { useStack } from '#stack/vitest.ts'

/** What a container's main process was started as. */
const commandOf = async (stack: Stack, service: 'circi' | 'worker') =>
  (await stack.exec(service, ['sh', '-c', 'tr "\\0" " " < /proc/1/cmdline'])).stdout.trim()

/**
 * Live updates across processes: a change reaches every server instance's streams through
 * Postgres, whichever process made it.
 */
describe('live updates: split deployment (serve and worker as separate containers)', () => {
  const ctx = useStack({ dedicated: true, topology: 'split', setup: true })
  let repo: Repo
  let stream: LiveStream | undefined

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    stream?.close()
    await repo.destroy()
  })

  it('the server process runs only the server and the worker container only the jobs', async () => {
    expect(await commandOf(ctx.stack, 'circi')).toMatch(/circi serve$/)
    expect(await commandOf(ctx.stack, 'worker')).toMatch(/circi worker$/)
  })

  it('a build finalized by the worker reaches a client connected to the server', async () => {
    const { stack, setup } = ctx
    const ws = setup.workspace.slug
    const project = await createProject(setup.session, ws, 'Split')
    stream = await LiveStream.open(setup.session)
    expect(stream.status).toBe(200)

    await repo.writeShots({ home: { dot: { x: 20, y: 20 } } })
    await repo.commit('split')
    const up = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    const finalized = await stream.waitFor(
      (e) => e.type === 'build.finalized' && e.build === up.build.number,
    )
    expect(finalized.event).toMatchObject({ workspace: ws, project: project.slug })

    // It was the worker container that did the work; the server container never ran a job.
    expect(await stack.logs('worker')).toMatch(/job|build|diff/i)
    expect((await stack.sql(`select count(*) from jobs where status <> 'done'`))[0]![0]).toBe('0')
  })
})

describe('live updates: two server instances on one Postgres', () => {
  const ctx = useStack({ dedicated: true, topology: 'second', setup: true })
  let repo: Repo
  const streams: LiveStream[] = []

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    for (const stream of streams) stream.close()
    await repo.destroy()
  })

  it('a change made through instance A reaches a stream on instance B, and the other way round', async () => {
    const { stack, setup } = ctx
    const ws = setup.workspace.slug
    const second = stack.secondUrl
    if (!second) throw new Error('the stack has no second server')
    expect(second).not.toBe(stack.url)
    const project = await createProject(setup.session, ws, 'Two servers')

    // The same sign-in works on both (same secret, same database).
    const onA = await LiveStream.open(setup.session)
    const onB = await LiveStream.open(setup.session, { base: second })
    streams.push(onA, onB)
    expect([onA.status, onB.status]).toEqual([200, 200])

    // A uploads (and its worker finalizes): B hears it.
    await repo.writeShots({ home: { dot: { x: 25, y: 25 } } })
    await repo.commit('two servers')
    const up = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    const number = up.build.number
    await onB.waitFor((e) => e.type === 'build.finalized' && e.build === number)

    // A review made through B (a server with no worker) reaches the stream on A, and B's own.
    const viaB = setup.session.on(second)
    await approveBuild(viaB, ws, project.slug, number)
    await onA.waitFor((e) => e.type === 'review.changed' && e.build === number)
    await onB.waitFor((e) => e.type === 'review.changed' && e.build === number)
  })
})
