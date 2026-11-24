import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { run } from '#stack/docker.ts'
import { REPO_ROOT } from '#stack/paths.ts'

/**
 * The shipped deploy files, as a user runs them: `deploy/docker-compose.yml` plus the S3 overlay
 * (Postgres, SeaweedFS, the bucket, CirCI built from deploy/Dockerfile) come up healthy, the admin
 * commands work inside the image, sign-in works, and the storage driver passes its live tests
 * against the overlay's S3 server. `pnpm test:compose`; the CircleCI job `compose-smoke` runs it.
 *
 * Own compose project name and free host ports, so it never touches the dev stack (3000, 9000 are
 * only the defaults). Logs are printed when a test fails, and the stack is always removed.
 */
const DEPLOY = join(REPO_ROOT, 'deploy')
const PROJECT = `circi-compose-${process.pid}`
const PASSWORD = 'ci-only-password-123'
const EMAIL = 'ci@example.com'

/** A port the OS hands out right now; the window before compose binds it is tiny. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('no port'))
      })
    })
  })
}

describe('deploy/docker-compose.yml with the S3 overlay', () => {
  let appUrl = ''
  let s3Url = ''
  let env: Record<string, string> = {}
  let failed = false

  const compose = (args: string[], options: run.Options = {}): Promise<run.Result> =>
    run(
      'docker',
      [
        'compose',
        '-p',
        PROJECT,
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.s3.yml',
        ...args,
      ],
      { cwd: DEPLOY, env, ...options },
    )
  const circi = (...args: string[]): Promise<run.Result> =>
    compose(['exec', '-T', 'circi', 'circi', ...args])

  beforeAll(async () => {
    const [appPort, s3Port] = await Promise.all([freePort(), freePort()])
    appUrl = `http://localhost:${appPort}`
    s3Url = `http://localhost:${s3Port}`
    env = {
      POSTGRES_PASSWORD: 'ci-only-password',
      BETTER_AUTH_SECRET: 'ci-only-secret-that-is-at-least-32-characters',
      CIRCI_PORT: String(appPort),
      S3_PORT: String(s3Port),
      PUBLIC_URL: appUrl,
    }
    await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '300'], {
      timeoutMs: 15 * 60_000,
    })
  })

  afterEach((context) => {
    if (context.task.result?.state === 'fail') failed = true
  })

  afterAll(async () => {
    if (failed) {
      const logs = await compose(['logs', '--no-color'], { allowFail: true })
      console.log(logs.stdout + logs.stderr)
    }
    await compose(['down', '-v', '--remove-orphans'], { allowFail: true })
  })

  it('is ready: the database and the S3 storage answer', async () => {
    const response = await fetch(`${appUrl}/readyz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ checks: { database: 'ok', storage: 'ok' } })
  })

  it('runs the admin commands inside the image', async () => {
    await circi('admin', 'user', 'create', '--email', EMAIL, '--name', 'CI', '--password', PASSWORD)
    await circi('admin', 'workspace', 'create', '--name', 'CI Workspace', '--owner', EMAIL)
    const created = await circi(
      'admin',
      'project',
      'create',
      '--org',
      'ci-workspace',
      '--name',
      'Web',
      '--json',
    )
    expect(created.stdout).toMatch(/"token": "circi_/)
    const listed = await circi('admin', 'project', 'list', '--org', 'ci-workspace')
    expect(listed.stdout).toContain('web')
  })

  it('needs sign-in for the dashboard API, and signing in opens it', async () => {
    expect((await fetch(`${appUrl}/api/projects`)).status).toBe(401)
    const signIn = await fetch(`${appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    expect(signIn.status).toBe(200)
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const projects = await fetch(`${appUrl}/api/projects`, { headers: { cookie } })
    expect(projects.status).toBe(200)
    expect(await projects.text()).toContain('"ci-workspace"')
  })

  it('passes the storage driver live tests against the overlay S3 server', async () => {
    const outputFile = join(mkdtempSync(join(tmpdir(), 'circi-compose-')), 'report.json')
    await run(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--project',
        'node',
        '--reporter=json',
        `--outputFile=${outputFile}`,
      ],
      {
        // @circi/storage's own Node tests, from its folder, where its vitest.config.ts is.
        cwd: join(REPO_ROOT, 'packages/storage'),
        // Empty, not unset: this run must not register the end-to-end projects or reporters.
        env: { CIRCI_TEST_S3_ENDPOINT: s3Url, E2E: '' },
        allowFail: true,
      },
    )
    const report = JSON.parse(readFileSync(outputFile, 'utf8')) as {
      numFailedTests: number
      testResults: { assertionResults: { fullName: string; status: string }[] }[]
    }
    const live = report.testResults
      .flatMap((file) => file.assertionResults)
      .filter((test) => test.fullName.includes('(live)'))
    expect(report.numFailedTests).toBe(0)
    expect(live.length).toBeGreaterThan(0)
    expect(live.every((test) => test.status === 'passed')).toBe(true)
  })
})
