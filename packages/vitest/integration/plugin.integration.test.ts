import { execFile } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

import { FakeCirci } from '@circi/testing/hosts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The `circi()` plugin against real Vitest browser mode (headless Chromium), on the project in
 * `fixtures/basic`: no references exist and no CirCI server is configured, so what is checked is
 * what a test run leaves on disk and whether the run passes.
 */
const run = promisify(execFile)
const PACKAGE = join(import.meta.dirname, '..')
const VITEST_BIN = join(PACKAGE, 'node_modules/vitest/vitest.mjs')

/** What a failed child process printed (`execFile`'s error carries both streams). */
function outputOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err)
  const streams = [Reflect.get(err, 'stdout'), Reflect.get(err, 'stderr')]
  return streams.filter((s) => typeof s === 'string').join('')
}

interface Outcome {
  passed: boolean
  output: string
}

/** The fixture project's own copy per describe, so runs never share references. */
function useFixture() {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(PACKAGE, 'test/fixtures/.run-'))
    await cp(join(PACKAGE, 'test/fixtures/basic'), dir, { recursive: true })
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return {
    dir: () => dir,
    async vitest(env: Record<string, string> = {}, config?: string): Promise<Outcome> {
      // Not the surrounding test run's own state: that would make this a nested run.
      const base = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !/^(VITEST|CI$|CIRCI_|NODE_ENV)/.test(k)),
      )
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          [VITEST_BIN, 'run', ...(config ? ['--config', config] : [])],
          {
            cwd: dir,
            env: { ...base, NO_COLOR: '1', ...env },
            timeout: 120_000,
          },
        )
        return { passed: true, output: stdout + stderr }
      } catch (err) {
        return { passed: false, output: outputOf(err) }
      }
    },
    async list(sub: string): Promise<string[]> {
      const entries = await readdir(join(dir, sub), { recursive: true }).catch(() => [])
      return entries.filter((e) => e.endsWith('.png')).toSorted()
    },
    read: (rel: string) => readFile(join(dir, rel)),
  }
}

// A real Vitest run starts Chromium; under a loaded machine (the whole Node project in parallel) it is slow.
const RUN_TIMEOUT = 400_000

const CAPTURES = ['shots.fixture.mjs/box.png', 'shots.fixture.mjs/card-renders-2.png']

describe('circi() with local: false (the default)', () => {
  const fixture = useFixture()

  it(
    'passes with no reference anywhere and leaves the captures for upload',
    { timeout: RUN_TIMEOUT },
    async () => {
      const first = await fixture.vitest()
      expect({ passed: first.passed, tail: first.output.slice(-1500) }).toMatchObject({
        passed: true,
      })
      // `.circi/screenshots/vitest/<test file>/<name>.png`; the unnamed call is `<describe> <test> <n>`.
      expect(await fixture.list('.circi/screenshots/vitest')).toEqual(CAPTURES)
      // Nothing is stored locally.
      expect(await fixture.list('__screenshots__')).toEqual([])
      expect(await fixture.list('.vitest')).toEqual([])
    },
  )

  it(
    'passes again, with the same names, even when the pixels changed',
    { timeout: RUN_TIMEOUT },
    async () => {
      const before = await fixture.read('.circi/screenshots/vitest/shots.fixture.mjs/box.png')
      const second = await fixture.vitest({ VITE_FIXTURE_COLOR: 'blue' })
      expect({ passed: second.passed, tail: second.output.slice(-1500) }).toMatchObject({
        passed: true,
      })
      expect(await fixture.list('.circi/screenshots/vitest')).toEqual(CAPTURES)
      expect(
        (await fixture.read('.circi/screenshots/vitest/shots.fixture.mjs/box.png')).equals(before),
      ).toBe(false)
      expect(await fixture.list('__screenshots__')).toEqual([])
    },
  )
})

describe('circi() as published', () => {
  const fixture = useFixture()

  it(
    'works from the built package: its setup file is in dist and loads in the browser',
    { timeout: RUN_TIMEOUT },
    async () => {
      const outcome = await fixture.vitest({}, 'vitest.dist.config.ts')
      expect({ passed: outcome.passed, tail: outcome.output.slice(-1500) }).toMatchObject({
        passed: true,
      })
      expect(await fixture.list('.circi/screenshots/vitest')).toEqual(CAPTURES)
    },
  )
})

describe('circi() with local: true', () => {
  const fixture = useFixture()
  const env = { FIXTURE_LOCAL: '1' }

  it(
    'is stock Vitest: a missing reference fails the run once, and is saved',
    { timeout: RUN_TIMEOUT },
    async () => {
      // One missing reference per run: Vitest stops the test at the first.
      const first = await fixture.vitest(env)
      expect(first.passed).toBe(false)
      expect(first.output).toContain('No existing reference screenshot found')
      expect(await fixture.list('__screenshots__')).toEqual([
        expect.stringMatching(/^shots\.fixture\.mjs\/box-chromium-\w+\.png$/),
      ])
      const second = await fixture.vitest(env)
      expect(second.passed).toBe(false)
      const third = await fixture.vitest(env)
      expect({ passed: third.passed, tail: third.output.slice(-1500) }).toMatchObject({
        passed: true,
      })
      expect(await fixture.list('.circi/screenshots/vitest')).toEqual(CAPTURES)
    },
  )

  it(
    'fails on a real change, and still produces the capture',
    { timeout: RUN_TIMEOUT },
    async () => {
      const changed = await fixture.vitest({ ...env, VITE_FIXTURE_COLOR: 'blue' })
      expect(changed.passed).toBe(false)
      expect(changed.output).toContain('does not match the stored reference')
      expect(await fixture.list('.circi/screenshots/vitest')).toContain('shots.fixture.mjs/box.png')
    },
  )
})

describe('circi() hosting the HTML report', () => {
  const fixture = useFixture()
  const ci = { CIRCI_COMMIT: 'd'.repeat(40), CIRCI_BRANCH: 'main' }

  it(
    "uploads the report Vitest's html reporter wrote, after it was written, as a vitest-report site",
    { timeout: RUN_TIMEOUT },
    async () => {
      const fake = await new FakeCirci().start()
      try {
        // No `reporters` in the fixture's config: the plugin adds the html reporter itself.
        const outcome = await fixture.vitest({
          FIXTURE_SITE: '1',
          CIRCI_API_URL: fake.url,
          CIRCI_TOKEN: 'circi_t',
          ...ci,
        })
        expect({ passed: outcome.passed, tail: outcome.output.slice(-1500) }).toMatchObject({
          passed: true,
        })
        // The screenshots went up first, then the site.
        const paths = fake.requests.map((r) => `${r.method} ${r.path.split('?')[0]}`)
        expect(paths.indexOf('POST /v1/sites')).toBeGreaterThan(
          paths.indexOf('POST /v1/builds/b1/finalize'),
        )
        const [site] = fake.to('/v1/sites?')
        const query = Object.fromEntries(new URL(`http://x${site?.path}`).searchParams)
        expect(query).toMatchObject({ name: 'vitest-report', kind: 'vitest-report' })
        // The archive holds the whole report as it was when it finished: the page and its data.
        const archive = gunzipSync(site?.body ?? Buffer.alloc(0)).toString('latin1')
        expect(archive.includes('index.html')).toBe(true)
        expect(archive.includes('html.meta.json.gz')).toBe(true)
      } finally {
        await fake.stop()
      }
    },
  )

  it('uploads no site unless asked', { timeout: RUN_TIMEOUT }, async () => {
    const fake = await new FakeCirci().start()
    try {
      const outcome = await fixture.vitest({
        CIRCI_API_URL: fake.url,
        CIRCI_TOKEN: 'circi_t',
        ...ci,
      })
      expect(outcome.passed).toBe(true)
      expect(fake.to('/v1/builds/b1/finalize')).toHaveLength(1)
      expect(fake.to('/v1/sites')).toHaveLength(0)
    } finally {
      await fake.stop()
    }
  })
})
