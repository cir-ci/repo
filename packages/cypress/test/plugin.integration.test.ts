import { execFile } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FakeCirci } from './support/fake-circi.ts'

/**
 * `circi()` and `@circi/cypress/support` against real Cypress (headless Electron), as published:
 * the project in `fixtures/basic` imports the built package, uses plain `cy.screenshot()`, and
 * uploads to a fake CirCI server. What is proven: the screenshots Cypress took, how they are named
 * and cropped, the files and sidecars left on disk, and what reached the (fake) server. CirCI's
 * own handling of the upload is not part of it.
 */
const run = promisify(execFile)
const PACKAGE = join(import.meta.dirname, '..')
const CYPRESS_BIN = join(PACKAGE, 'node_modules/cypress/bin/cypress')
// The fixture's page: 800 CSS pixels wide, content 200 tall (a card 200 by 100 below an 80 tall header).
const VIEWPORT = { width: 800, height: 600 }
const CONTENT_HEIGHT = 200

/** Width and height of a PNG, from its header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function outputOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err)
  return [Reflect.get(err, 'stdout'), Reflect.get(err, 'stderr')]
    .filter((s) => typeof s === 'string')
    .join('')
}

interface Outcome {
  code: number
  output: string
}

/** The fixture project's own copy, so runs never share a screenshots folder. */
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
    async cypress(
      spec: string,
      env: Record<string, string> = {},
      testingType: 'e2e' | 'component' = 'e2e',
    ): Promise<Outcome> {
      // Not the surrounding test run's own state (a nested Vitest or CI environment).
      const base = Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !/^(VITEST|CI$|CIRCI_|CYPRESS_|NODE_ENV|GITHUB_|GITLAB_|CIRCLE)/.test(k),
        ),
      )
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          [CYPRESS_BIN, 'run', `--${testingType}`, '--browser', 'electron', '--spec', spec],
          { cwd: dir, env: { ...base, NO_COLOR: '1', ...env }, timeout: 280_000 },
        )
        return { code: 0, output: stdout + stderr }
      } catch (err) {
        const code = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined
        return { code: typeof code === 'number' ? code : 1, output: outputOf(err) }
      }
    },
    async list(sub: string): Promise<string[]> {
      const entries = await readdir(join(dir, sub), { recursive: true, withFileTypes: true }).catch(
        () => [],
      )
      return entries
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name).slice(join(dir, sub).length + 1))
        .toSorted()
    },
    read: (rel: string) => readFile(join(dir, rel)),
  }
}

/** The environment that says where to upload, and which commit, as a CI does. */
function ciEnv(fake: FakeCirci): Record<string, string> {
  return {
    CIRCI_API_URL: fake.url,
    CIRCI_TOKEN: 'circi_test',
    GITLAB_CI: 'true',
    CI_COMMIT_SHA: 'a'.repeat(40),
    CI_COMMIT_BRANCH: 'feature',
  }
}

/** The screenshots the finalize request lists: what the build holds, by name. */
function screenshotsOf(fake: FakeCirci): { name: string; metadata?: unknown }[] {
  const body = fake.json('POST', '/v1/builds/b1/finalize')
  const list: unknown = body?.screenshots
  if (!Array.isArray(list)) return []
  return list.flatMap((s: unknown) =>
    typeof s === 'object' && s !== null && 'name' in s && typeof s.name === 'string'
      ? [{ name: s.name, metadata: 'metadata' in s ? s.metadata : undefined }]
      : [],
  )
}

// A real Cypress run starts Electron; slow on a loaded machine.
const RUN_TIMEOUT = 300_000
const SHOTS = [
  'shots.cy.js/home.png',
  'shots.cy.js/home.png.json',
  'shots.cy.js/padded.png',
  'shots.cy.js/padded.png.json',
  'shots.cy.js/parts/card.png',
  'shots.cy.js/parts/card.png.json',
]

describe('circi() with real Cypress', () => {
  const fixture = useFixture()
  const fake = new FakeCirci()
  let outcome: Outcome
  let ratio = 1

  beforeAll(async () => {
    await fake.start()
    outcome = await fixture.cypress('cypress/e2e/shots.cy.js', ciEnv(fake))
    const home = await fixture
      .read('.circi/screenshots/shots.cy.js/home.png')
      .catch(() => undefined)
    // The display's pixel ratio: a Retina machine takes 2x images.
    if (home) ratio = pngSize(home).width / VIEWPORT.width
  }, RUN_TIMEOUT)
  afterAll(() => fake.stop())

  it(
    'passes and leaves the named screenshots, by spec file and name, with sidecars',
    { timeout: RUN_TIMEOUT },
    async () => {
      expect({ code: outcome.code, tail: outcome.output.slice(-1500) }).toMatchObject({ code: 0 })
      // Unnamed ones (and failure screenshots) are not part of the review.
      expect(await fixture.list('.circi/screenshots')).toEqual(SHOTS)
      const sidecar = JSON.parse(
        (await fixture.read('.circi/screenshots/shots.cy.js/home.png.json')).toString('utf8'),
      )
      expect(sidecar).toEqual({ spec: 'shots.cy.js', browser: 'electron', viewport: VIEWPORT })
    },
  )

  it('crops an element to its own box, and to nothing more', async () => {
    const card = pngSize(await fixture.read('.circi/screenshots/shots.cy.js/parts/card.png'))
    expect(card).toEqual({ width: 200 * ratio, height: 100 * ratio })
  })

  it('adds the padding asked for, on purpose', async () => {
    const padded = pngSize(await fixture.read('.circi/screenshots/shots.cy.js/padded.png'))
    expect(padded).toEqual({ width: 220 * ratio, height: 120 * ratio })
  })

  it('takes a short page at the height of its content, not of the viewport', async () => {
    const home = pngSize(await fixture.read('.circi/screenshots/shots.cy.js/home.png'))
    expect(home).toEqual({ width: VIEWPORT.width * ratio, height: CONTENT_HEIGHT * ratio })
  })

  it('refuses an element with nothing to show instead of saving a blank image', () => {
    // The spec asserts the error itself; the run passing means the test saw "nothing to capture".
    expect(outcome.output).toContain('refuses an element that has nothing to show')
    expect(outcome.output).not.toMatch(/hidden\.png/)
  })

  it('uploaded the screenshots in one build, named like @circi/vitest names them', () => {
    expect(fake.json('POST', '/v1/builds')).toMatchObject({
      name: 'cypress-fixture',
      commitSha: 'a'.repeat(40),
    })
    const files = screenshotsOf(fake)
    expect(files.map((f) => f.name).toSorted()).toEqual([
      'shots.cy.js/home',
      'shots.cy.js/padded',
      'shots.cy.js/parts/card',
    ])
    // Their sidecar's metadata travels with them.
    expect(files[0]).toMatchObject({ metadata: { spec: 'shots.cy.js', browser: 'electron' } })
    expect(fake.uploads().size).toBe(3)
  })
})

describe('circi() when a test fails', () => {
  const fixture = useFixture()
  const fake = new FakeCirci()
  let outcome: Outcome

  beforeAll(async () => {
    await fake.start()
    outcome = await fixture.cypress('cypress/e2e/failing.cy.js', ciEnv(fake))
  }, RUN_TIMEOUT)
  afterAll(() => fake.stop())

  it(
    "uploads the test's named screenshot but not Cypress's automatic failure screenshot",
    { timeout: RUN_TIMEOUT },
    async () => {
      expect(outcome.code).not.toBe(0)
      // Cypress did take its own failure screenshot...
      expect(await fixture.list('cypress/screenshots')).toContain(
        'failing.cy.js/failing -- fails, and Cypress takes its own screenshot (failed).png',
      )
      // ...and only the named one is in the build.
      expect(await fixture.list('.circi/screenshots')).toEqual([
        'failing.cy.js/before-failure.png',
        'failing.cy.js/before-failure.png.json',
      ])
      expect(screenshotsOf(fake).map((f) => f.name)).toEqual(['failing.cy.js/before-failure'])
    },
  )
})

describe('circi() without a token', () => {
  const fixture = useFixture()

  it(
    'skips the upload with a warning and the run is unaffected',
    { timeout: RUN_TIMEOUT },
    async () => {
      const outcome = await fixture.cypress('cypress/e2e/shots.cy.js')
      expect({ code: outcome.code, tail: outcome.output.slice(-1500) }).toMatchObject({ code: 0 })
      expect(outcome.output).toContain(
        '[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots',
      )
    },
  )
})

describe('circi() with wait: true', () => {
  const fixture = useFixture()
  const fake = new FakeCirci()

  beforeAll(async () => {
    await fake.start()
    fake.outcome = 'fail'
  })
  afterAll(() => fake.stop())

  it('fails the run while changes need review', { timeout: RUN_TIMEOUT }, async () => {
    const outcome = await fixture.cypress('cypress/e2e/shots.cy.js', {
      ...ciEnv(fake),
      FIXTURE_WAIT: '1',
    })
    expect(outcome.output).toContain('Changes found')
    expect(outcome.code).not.toBe(0)
  })
})

describe('circi() in component testing', () => {
  const fixture = useFixture()
  let outcome: Outcome

  beforeAll(async () => {
    outcome = await fixture.cypress('cypress/component/button.cy.js', {}, 'component')
  }, RUN_TIMEOUT)

  it(
    'takes the mounted component at its own box, not the viewport',
    { timeout: RUN_TIMEOUT },
    async () => {
      expect({ code: outcome.code, tail: outcome.output.slice(-1500) }).toMatchObject({ code: 0 })
      expect(await fixture.list('.circi/screenshots')).toEqual([
        'button.cy.js/button/primary.png',
        'button.cy.js/button/primary.png.json',
      ])
      const button = pngSize(
        await fixture.read('.circi/screenshots/button.cy.js/button/primary.png'),
      )
      // The button is 120 by 40 with a 30px margin: the margin is outside its box.
      const ratio = button.width / 120
      expect(button).toEqual({ width: 120 * ratio, height: 40 * ratio })
      expect(ratio).toBeGreaterThanOrEqual(1)
    },
  )
})
