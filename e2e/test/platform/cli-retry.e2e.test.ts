// oxlint-disable vitest/valid-expect -- expect(value, message) puts the CLI's stderr in the failure
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createProject } from '#clients/admin.ts'
import { uploadBuild } from '#clients/upload.ts'
import { type FaultProxy, startFaultProxy } from '#fakes/fault-proxy.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * The CLI's retries against the real server, through a proxy on the host that cuts or fails
 * requests the way a flaky gateway does (e2e/src/fakes/fault-proxy.ts). The real built CLI runs
 * with `CIRCI_API_URL` pointing at the proxy; file uploads go to the addresses the server gives
 * (straight to the stack), so only the API calls are exposed to the faults.
 */
describe('CLI retry safety (real CLI, real server, a fault-injecting proxy)', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  let proxy: FaultProxy
  let repo: Repo
  let n = 0

  beforeAll(async () => {
    proxy = await startFaultProxy(ctx.stack.url)
    repo = await Repo.create()
  })
  afterAll(async () => {
    await proxy.close()
    await repo.destroy()
  })
  beforeEach(() => {
    proxy.reset()
  })

  /** A project of its own, so its build list says exactly what the server made. */
  const freshProject = async (label: string) => {
    n += 1
    const project = await createProject(
      ctx.setup.session,
      ctx.setup.workspace.slug,
      `${label} ${n}`,
    )
    await repo.writeShots({ home: { dot: { x: 5 * n, y: 5 * n } } })
    await repo.commit(`${label} ${n}`)
    return project
  }
  /** The numbers of the project's builds, straight from the database. */
  const buildsOf = async (slug: string) =>
    (
      await ctx.stack.sql(
        `select b.number from builds b join projects p on p.id = b.project_id join workspace w on w.id = p.workspace_id where w.slug = '${ctx.setup.workspace.slug}' and p.slug = '${slug}' order by b.number`,
      )
    ).map(([number]) => Number(number))

  const upload = (token: string, wait = false) =>
    uploadBuild({ stack: { url: proxy.url }, token, repo, wait })

  it('a build creation whose answer is lost is sent again with the same Idempotency-Key and returns the same build', async () => {
    const project = await freshProject('Create')
    // The server creates the build; the answer never reaches the CLI.
    proxy.inject({
      match: (r) => r.method === 'POST' && r.url === '/v1/builds',
      fault: { dropAfter: true },
    })
    const run = await upload(project.token)
    expect(run.exitCode, run.stderr).toBe(0)

    const creates = proxy.requests.filter((r) => r.method === 'POST' && r.url === '/v1/builds')
    expect(creates.map((r) => r.outcome)).toEqual(['dropped', 201])
    const keys = creates.map((r) => r.headers['idempotency-key'])
    expect(keys[0]).toMatch(/^[\w-]{8,}$/)
    expect(keys[1]).toBe(keys[0])
    // Both answers describe the one build, and it is the build the CLI went on with.
    const [first, second] = creates.map((r) => JSON.parse(r.upstreamBody ?? '{}').build)
    expect(second.id).toBe(first.id)
    expect(run.result?.build.id).toBe(first.id)
    // No stray build: the project has exactly one.
    expect(await buildsOf(project.slug)).toEqual([1])
  })

  it('a new upload gets a new key, so two builds of one project are two builds', async () => {
    const project = await freshProject('Keys')
    await upload(project.token)
    await repo.writeShots({ home: { dot: { x: 90, y: 90 } } })
    await repo.commit('again')
    await upload(project.token)
    const keys = proxy.requests
      .filter((r) => r.method === 'POST' && r.url === '/v1/builds')
      .map((r) => r.headers['idempotency-key'])
    expect(new Set(keys).size).toBe(2)
    expect(await buildsOf(project.slug)).toEqual([1, 2])
  })

  it('a finalize whose answer is lost is sent again and gets the same answer as the first, not a 409', async () => {
    const project = await freshProject('Finalize')
    proxy.inject({
      match: (r) => r.method === 'POST' && r.url.endsWith('/finalize'),
      fault: { dropAfter: true },
    })
    const run = await upload(project.token, true)
    // The project's first build waits for review (exit 1); a failed upload would be 2 or more.
    expect(run.exitCode, run.stderr).toBeLessThanOrEqual(1)

    const finalizes = proxy.requests.filter((r) => r.url.endsWith('/finalize'))
    expect(finalizes.map((r) => r.outcome)).toEqual(['dropped', 200])
    expect(finalizes.map((r) => r.upstreamStatus)).toEqual([200, 200])
    const [first, second] = finalizes.map((r) => JSON.parse(r.upstreamBody ?? '{}'))
    expect(second).toMatchObject({ complete: true, shardsReceived: 1, shardsTotal: 1 })
    expect(second.build.id).toBe(first.build.id)
    // The build went on to be processed once.
    expect(run.result?.status?.build.status).toBe('complete')
    expect(await buildsOf(project.slug)).toEqual([1])
  })

  it('--wait survives 502s from a gateway while it polls, and says it is still waiting', async () => {
    const project = await freshProject('Poll')
    // Five 502s for the build's status: the first poll uses up the CLI's four attempts and gives
    // up on that poll, the second fails once more and then succeeds. The CLI keeps waiting.
    proxy.inject({
      match: (r) => r.method === 'GET' && r.url.includes('/status'),
      times: 5,
      fault: { status: 502 },
    })
    const run = await upload(project.token, true)
    expect(run.exitCode, run.stderr).toBeLessThanOrEqual(1)
    expect(run.result?.status?.build.status).toBe('complete')
    expect(run.stderr).toContain('still waiting')

    const polls = proxy.requests.filter((r) => r.method === 'GET' && r.url.includes('/status'))
    expect(polls.filter((r) => r.outcome === 502)).toHaveLength(5)
    expect(polls.at(-1)?.outcome).toBe(200)
  }, 90_000)
})
